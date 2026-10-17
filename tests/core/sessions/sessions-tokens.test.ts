/**
 * POST /tokens: renovação pública e rotação de refresh tokens.
 */
import { createHash } from "node:crypto";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { verifyAccessToken } from "../../../src/utils/jwt";
import { resetMocks } from "../../helpers/reset";
import { IDS } from "../../helpers/factories";
import { bearerAuth } from "../../helpers/auth";

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;
type ProblemBody = {
  status: number;
  title?: string;
  errors?: Array<{ field: string; message: string }>;
  [extension: string]: unknown;
};
type TokenBody = {
  accessToken: string;
  refreshToken: string;
  _links: Record<string, { href: string; method: string }>;
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => resetMocks());

const refreshToken = "r".repeat(40);
const sessao = { id: "sess-1", usuarioId: IDS.user };
const userOk = {
  id: IDS.user,
  emailPessoal: "joao@example.com",
  papel: "USUARIO",
  ativo: true,
  deletadoEm: null,
};
const sessaoAtiva = {
  id: "sess-1",
  criadoEm: new Date("2026-10-13T10:00:00Z"),
  ultimoUsoEm: new Date("2026-10-13T10:05:00Z"),
  expiraEm: new Date("2026-10-20T10:00:00Z"),
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0",
};
const call = (payload?: unknown) => app.inject({ method: "POST", url: "/tokens", payload });

function expectProblem(res: InjectResponse, status: number): ProblemBody {
  expect(res.statusCode).toBe(status);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  const body = res.json<ProblemBody>();
  expect(body.status).toBe(status);
  return body;
}

function expectNoRefreshRotation(): void {
  expect(prismaMock.sessao.update).not.toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ refreshHash: expect.any(String) }),
    }),
  );
}

function arrangeSuccessfulRefresh(): void {
  prismaMock.sessao.findFirst.mockResolvedValueOnce(sessao);
  prismaMock.usuario.findUnique.mockResolvedValueOnce(userOk);
  prismaMock.sessao.update.mockResolvedValue({});
}

describe("POST /tokens", () => {
  it("201 — renova tokens, preserva sid e grava o hash do novo refresh", async () => {
    arrangeSuccessfulRefresh();

    // Público: a requisição não precisa de Authorization.
    const res = await call({ refreshToken });

    expect(res.statusCode).toBe(201);
    expect(String(res.headers["cache-control"])).toContain("no-store");
    expect(res.headers.location).toBeUndefined();
    const body = res.json<TokenBody>();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).not.toBe(refreshToken);
    expect(body._links).toBeDefined();
    expect(verifyAccessToken(body.accessToken)).toMatchObject({
      sub: IDS.user,
      sid: "sess-1",
    });
    expect(prismaMock.sessao.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: {
        refreshHash: createHash("sha256").update(body.refreshToken).digest("hex"),
        ultimoUsoEm: expect.any(Date),
      },
    });
  });

  it("responde com session, user e refresh, sem self", async () => {
    arrangeSuccessfulRefresh();

    const res = await call({ refreshToken });
    const body = res.json<TokenBody>();

    expect(body._links).toEqual({
      session: { href: "/sessions/current", method: "GET" },
      user: { href: "/users/me", method: "GET" },
      refresh: { href: "/tokens", method: "POST" },
    });
    expect(body._links).not.toHaveProperty("self");
  });

  it("ignora um Authorization inválido quando o refresh token é válido", async () => {
    arrangeSuccessfulRefresh();

    const res = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer lixo" },
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(201);
  });

  it("só procura sessão não revogada e não expirada", async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce(null);

    await call({ refreshToken });

    expect(prismaMock.sessao.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        revogadaEm: null,
        expiraEm: { gt: expect.any(Date) },
      }),
    });
    expectNoRefreshRotation();
  });

  it("401 — sessão inexistente, revogada ou expirada", async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce(null);

    const res = await call({ refreshToken });
    const body = expectProblem(res, 401);

    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(body.title).toBe("Refresh token inválido");
    expect(body).not.toHaveProperty("error");
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();
    expectNoRefreshRotation();
  });

  it("401 — usuário inativo revoga a sessão", async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce(sessao);
    prismaMock.usuario.findUnique.mockResolvedValueOnce({ ...userOk, ativo: false });
    prismaMock.sessao.update.mockResolvedValue({});

    const res = await call({ refreshToken });

    expectProblem(res, 401);
    expect(prismaMock.sessao.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { revogadaEm: expect.any(Date) },
    });
    expectNoRefreshRotation();
  });

  it("401 — usuário apagado revoga a sessão", async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce(sessao);
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      ...userOk,
      deletadoEm: new Date(),
    });
    prismaMock.sessao.update.mockResolvedValue({});

    const res = await call({ refreshToken });

    expectProblem(res, 401);
    expect(prismaMock.sessao.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { revogadaEm: expect.any(Date) },
    });
    expectNoRefreshRotation();
  });

  it("401 — usuário inexistente revoga a sessão em vez de responder 500", async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce(sessao);
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null);
    prismaMock.sessao.update.mockResolvedValue({});

    const res = await call({ refreshToken });

    expectProblem(res, 401);
    expect(prismaMock.sessao.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { revogadaEm: expect.any(Date) },
    });
    expectNoRefreshRotation();
  });

  it.each([
    ["sem corpo", undefined],
    ["objeto vazio", {}],
    ["refreshToken não string", { refreshToken: 123 }],
    ["refreshToken curto", { refreshToken: "curto" }],
  ])("400 — corpo inválido: %s", async (_caseName, payload) => {
    const res = await call(payload);
    const body = expectProblem(res, 400);

    expect(body.errors?.length).toBeGreaterThan(0);
    if (payload && typeof payload === "object" && Object.keys(payload).length === 0) {
      expect(body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "refreshToken" })]),
      );
    }
    expect(prismaMock.sessao.findFirst).not.toHaveBeenCalled();
    expectNoRefreshRotation();
  });

  it("500 — falha inesperada não vaza mensagem interna", async () => {
    prismaMock.sessao.findFirst.mockRejectedValueOnce(new Error("segredo-interno"));

    const res = await call({ refreshToken });

    expectProblem(res, 500);
    expect(res.body).not.toContain("segredo-interno");
    expectNoRefreshRotation();
  });

  it("contrato — o link session aceita o access token recém-emitido", async () => {
    prismaMock.sessao.findFirst
      .mockResolvedValueOnce(sessao)
      .mockResolvedValueOnce(sessaoAtiva);
    prismaMock.usuario.findUnique.mockResolvedValueOnce(userOk);
    prismaMock.sessao.update.mockResolvedValue({});

    const tokenResponse = await call({ refreshToken });
    const body = tokenResponse.json<TokenBody>();
    const sessionLink = body._links.session;
    const res = await app.inject({
      method: sessionLink.method,
      url: sessionLink.href,
      headers: bearerAuth(body.accessToken),
    });

    expect(res.statusCode).toBe(200);
  });

  it("resposta inclui cookies accessToken e refreshToken", async () => {
    arrangeSuccessfulRefresh();

    const res = await call({ refreshToken });
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

    expect(cookies.some((cookie) => cookie.startsWith("accessToken="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("refreshToken="))).toBe(true);
  });
});
