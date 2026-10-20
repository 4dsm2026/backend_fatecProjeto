/**
 * POST /sessions: login HAL, RFC 7807 e preservação da autenticação das rotas atuais.
 */
import { createHash } from "node:crypto";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));
vi.mock("../../../src/security/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed:password"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../src/security/dummy-verify", () => ({
  verifyDummyPassword: vi.fn().mockResolvedValue(undefined),
}));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { verifyDummyPassword } from "../../../src/security/dummy-verify";
import * as passwordModule from "../../../src/security/password";
import { buildSessionLinks } from "../../../src/core/sessions/sessions.links";
import { makeLoginUser } from "../../helpers/factories";
import { bearerAuth } from "../../helpers/auth";
import { resetMocks } from "../../helpers/reset";
import { verifyAccessToken } from "../../../src/utils/jwt";

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;
type ProblemBody = {
  status: number;
  title?: string;
  type?: string;
  detail?: string;
  errors?: Array<{ field: string; message: string }>;
  attemptsLeft?: number;
  retryAfter?: number;
  token?: string;
  user?: unknown;
  _links?: {
    activate?: { href: string; method: string };
  };
  [key: string]: unknown;
};
type SessionBody = {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
  _links: ReturnType<typeof buildSessionLinks> & {
    self: { href: string; method: "GET" };
  };
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMocks();
  vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true);
  vi.mocked(passwordModule.hashPassword).mockResolvedValue("hashed:password");
  prismaMock.loginTentativa.create.mockResolvedValue({});
  prismaMock.sessao.create.mockResolvedValue({ id: "session-001" });
  prismaMock.tokenResetSenha.create.mockResolvedValue({ id: "token-001" });
  prismaMock.usuario.update.mockResolvedValue(makeLoginUser());
});

function expectProblem(res: InjectResponse, status: number): ProblemBody {
  expect(res.statusCode).toBe(status);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  const body = res.json<ProblemBody>();
  expect(body.status).toBe(status);
  return body;
}

function expectNoSessionCreated(): void {
  expect(prismaMock.sessao.create).not.toHaveBeenCalled();
}

const emailPayload = { email: "joao@example.com", password: "Test@1234" };

describe("POST /sessions", () => {
  it("201 — cria sessão por e-mail com usuário público e links HAL", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser());

    // Sem Authorization: POST /sessions é público.
    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });

    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe("/sessions/current");
    expect(String(res.headers["cache-control"])).toContain("no-store");
    const body = res.json<SessionBody>();
    expect(body.user).toMatchObject({
      id: "user-id-001",
      nome: "João Silva",
      ra: null,
      papel: "USUARIO",
      emailPessoal: "joao@example.com",
      ativo: true,
      precisaTrocarSenha: false,
    });
    for (const key of ["senhaHash", "loginAttempts", "lockedUntil", "lastFailedAttempt"]) {
      expect(body.user).not.toHaveProperty(key);
    }
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body._links).toEqual(buildSessionLinks());
    expect(verifyAccessToken(body.accessToken).sid).toBe("session-001");
    expect(prismaMock.sessao.create).toHaveBeenCalledTimes(1);
  });

  it("201 — autentica por RA e consulta pelo campo ra", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ ra: "1234567" }));

    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { ra: "1234567", password: "Test@1234" },
    });

    expect(res.statusCode).toBe(201);
    expect(prismaMock.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ra: "1234567" } }),
    );
    expect(prismaMock.sessao.create).toHaveBeenCalledTimes(1);
  });

  it("401 — usuário inexistente verifica senha dummy e não expõe error", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 401);

    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(body).not.toHaveProperty("error");
    expect(vi.mocked(verifyDummyPassword)).toHaveBeenCalledTimes(1);
    expectNoSessionCreated();
  });

  it("401 — hash ausente verifica senha dummy sem comparar hash", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ senhaHash: null }));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });

    expectProblem(res, 401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(vi.mocked(passwordModule.verifyPassword)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyDummyPassword)).toHaveBeenCalledTimes(1);
    expectNoSessionCreated();
  });

  it("401 — senha errada retorna attemptsLeft e detalhe de aviso", async () => {
    vi.mocked(passwordModule.verifyPassword).mockResolvedValueOnce(false);
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser());
    prismaMock.usuario.update.mockResolvedValueOnce(makeLoginUser({ loginAttempts: 3 }));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 401);

    expect(body.attemptsLeft).toBe(2);
    expect(body.detail).toContain("2 tentativa(s) restante(s)");
    expectNoSessionCreated();
  });

  it("401 — a quinta senha incorreta continua sem criar sessão", async () => {
    vi.mocked(passwordModule.verifyPassword).mockResolvedValueOnce(false);
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser());
    prismaMock.usuario.update
      .mockResolvedValueOnce(makeLoginUser({ loginAttempts: 5 }))
      .mockResolvedValueOnce(makeLoginUser({ loginAttempts: 5 }));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 401);

    expect(body.attemptsLeft).toBeLessThanOrEqual(0);
    expectNoSessionCreated();
  });

  it("403 — usuário inativo", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ ativo: false }));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 403);

    expect(body.title).toBe("Usuário inativo");
    expectNoSessionCreated();
  });

  it("429 — conta bloqueada fornece Retry-After igual à extensão retryAfter", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(
      makeLoginUser({ lockedUntil: new Date(Date.now() + 15 * 60_000) }),
    );

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 429);
    const retryAfter = Number(res.headers["retry-after"]);

    expect(body.type).toBe("/errors/account-locked");
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBe(body.retryAfter);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expectNoSessionCreated();
  });

  it("403 — primeiro acesso retorna somente link com o token original", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ precisaTrocarSenha: true }));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 403);
    const activationLink = body._links?.activate;
    expect(body.type).toBe("/errors/password-change-required");
    expect(activationLink?.method).toBe("PUT");
    expect(activationLink?.href).toMatch(/^\/account-activations\/.+$/);
    const token = activationLink?.href.split("/").at(-1);

    expect(token).toBeTruthy();
    expect(prismaMock.tokenResetSenha.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: createHash("sha256").update(token ?? "").digest("hex"),
        finalidade: "PRIMEIRO_ACESSO",
      }),
    });
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("user");
    expectNoSessionCreated();
  });

  it("400 — corpo sem senha informa o campo inválido", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { email: "joao@example.com" },
    });
    const body = expectProblem(res, 400);

    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "password" })]));
    expectNoSessionCreated();
  });

  it("400 — corpo sem e-mail e sem RA", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { password: "Test@1234" },
    });
    const body = expectProblem(res, 400);

    expect(body.errors?.length).toBeGreaterThan(0);
    expectNoSessionCreated();
  });

  it("400 — corpo com e-mail e RA", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { email: "joao@example.com", ra: "1234567", password: "Test@1234" },
    });
    const body = expectProblem(res, 400);

    expect(body.errors?.length).toBeGreaterThan(0);
    expectNoSessionCreated();
  });

  it("500 — falha inesperada não revela mensagem interna nem debug", async () => {
    prismaMock.usuario.findUnique.mockRejectedValueOnce(new Error("segredo-interno"));

    const res = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = expectProblem(res, 500);

    expect(body).not.toHaveProperty("debug");
    expect(res.body).not.toContain("segredo-interno");
    expectNoSessionCreated();
  });

  it("contrato — o link self da sessão criada responde sem 403 ou 405", async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser());
    const login = await app.inject({ method: "POST", url: "/sessions", payload: emailPayload });
    const body = login.json<SessionBody>();
    prismaMock.sessao.findFirst.mockResolvedValueOnce({
      id: "session-001",
      criadoEm: new Date(),
      ultimoUsoEm: new Date(),
      expiraEm: new Date(Date.now() + 60_000),
      ip: null,
      userAgent: null,
    });

    const self = body._links.self;
    const res = await app.inject({
      method: self.method,
      url: self.href,
      headers: bearerAuth(body.accessToken),
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(405);
    expect(res.statusCode).toBe(200);
  });

  it("GET /sessions/current sem token continua 401", async () => {
    const res = await app.inject({ method: "GET", url: "/sessions/current" });

    expectProblem(res, 401);
    expectNoSessionCreated();
  });
});
