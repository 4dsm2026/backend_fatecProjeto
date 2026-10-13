import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Link } from "../../src/hateoas/types";
import { registerProblemHandler } from "../../src/hateoas";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import authVerify from "../../src/plugins/auth-verify";
import prismaPlugin from "../../src/plugins/prisma";
import { makeAdminToken, makeUserToken, bearerAuth } from "../helpers/auth";
import { usersRoutes } from "../../src/core/users/users.routes";
import type { UserResponse } from "../../src/types/users";

vi.mock("../../src/lib/prisma");
vi.mock("../../src/security/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed:password"),
}));

const fixedDate = new Date("2026-01-01T00:00:00.000Z");
const activeUser: UserResponse = {
  id: "user-1",
  organizacaoId: null,
  nome: "Ana Silva",
  emailPessoal: "ana@example.com",
  emailEducacional: null,
  ra: "RA-1",
  cursoNome: "DSM",
  cursoSigla: "DSM",
  papel: "USUARIO",
  ativo: true,
  anonimizado: false,
  criadoEm: fixedDate,
  atualizadoEm: fixedDate,
  deletadoEm: null,
  unidadeFatec: null,
  curso: null,
  eixoTecnologico: null,
  turno: null,
  turma: null,
  semestreAtual: null,
  matrizCurricular: null,
  situacaoAcademica: null,
  anoSemestreIngresso: null,
  coordenadorCurso: null,
  telefoneCelular: null,
  whatsapp: null,
  canalPreferencialContato: null,
  melhorPeriodoContato: null,
  necessitaAtendimentoAcessivel: false,
  tipoAcessibilidade: null,
  observacoesAtendimento: null,
  notificacoesInApp: true,
};

function makeUser(changes: Partial<UserResponse> = {}): UserResponse {
  return { ...activeUser, ...changes };
}

function tokenFor(role: "USUARIO" | "BACKOFFICE" | "TECNICO" | "ADMINISTRADOR", sub = "user-1") {
  if (role === "ADMINISTRADOR") return makeAdminToken({ sub });
  return makeUserToken({ sub, role });
}

function resetPrismaMocks(): void {
  vi.resetAllMocks();
  prismaMock.$connect.mockResolvedValue(undefined);
  prismaMock.$disconnect.mockResolvedValue(undefined);
  prismaMock.$queryRaw.mockResolvedValue([{ 1: 1 }]);
  prismaMock.usuario.create.mockResolvedValue(makeUser({ id: "created-1", nome: "João Silva" }));
  prismaMock.usuario.findUnique.mockResolvedValue(activeUser);
  prismaMock.usuario.findMany.mockResolvedValue([activeUser]);
  prismaMock.usuario.update.mockResolvedValue(activeUser);
  prismaMock.usuario.count.mockResolvedValue(45);
  prismaMock.auditoria.create.mockResolvedValue({});
}

async function callLink(app: FastifyInstance, item: Link, token: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: item.method ?? "GET",
    url: item.href,
    headers: bearerAuth(token),
    ...(payload ? { payload } : {}),
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  resetPrismaMocks();
  app = Fastify({ logger: false });
  await app.register(prismaPlugin);
  await app.register(authVerify);
  registerProblemHandler(app);
  await app.register(usersRoutes, { prefix: "/users" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetPrismaMocks();
});

describe("users HAL routes", () => {
  it("creates a user with 201, Location and a public HAL resource", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
      payload: {
        nome: "João Silva",
        emailPessoal: "joao@example.com",
        senha: "StrongPassword123!",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/users/created-1");
    expect(response.json()._links.self).toEqual({ href: "/users/created-1", method: "GET" });
    expect(response.json()).not.toHaveProperty("senhaHash");
    expect(response.json()).not.toHaveProperty("loginAttempts");
    expect(response.json()).not.toHaveProperty("lockedUntil");
    expect(response.json()).toHaveProperty("necessitaAtendimentoAcessivel");
    expect(response.json()).toHaveProperty("observacoesAtendimento");
  });

  it.each(["USUARIO", "BACKOFFICE", "TECNICO"] as const)("%s cannot create users", async (role) => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearerAuth(tokenFor(role)),
      payload: { nome: "João Silva", emailPessoal: "joao@example.com", senha: "StrongPassword123!" },
    });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.usuario.create).not.toHaveBeenCalled();
  });

  it("rejects missing name with a problem response", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
      payload: { emailPessoal: "joao@example.com", senha: "StrongPassword123!" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json().errors).toContainEqual({ field: "body.nome", message: "Nome é obrigatório." });
  });

  it("lists a page-zero HAL collection and preserves q in navigation links", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users?q=Ana%20Silva",
      headers: bearerAuth(tokenFor("BACKOFFICE", "staff-1")),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()._embedded.users).toHaveLength(1);
    expect(response.json().page).toEqual({ size: 20, number: 0, totalElements: 45, totalPages: 3 });
    expect(response.json()._links.prev).toBeUndefined();
    expect(response.json()._links.next.href).toBe("/users?page=1&q=Ana%20Silva&size=20");
    expect(response.json()._embedded.users[0]._links.self.href).toBe("/users/user-1");
    expect(prismaMock.usuario.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
  });

  it("accepts size=100 and rejects page below zero or size above 100", async () => {
    const headers = bearerAuth(tokenFor("TECNICO", "tech-1"));
    const maximum = await app.inject({ method: "GET", url: "/users?page=0&size=100", headers });
    const negativePage = await app.inject({ method: "GET", url: "/users?page=-1", headers });
    const oversized = await app.inject({ method: "GET", url: "/users?size=101", headers });

    expect(maximum.statusCode).toBe(200);
    expect(prismaMock.usuario.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
    expect(negativePage.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
  });

  it("emits prev/next/last links for a middle page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users?page=2&size=10&q=Ana",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
    });

    expect(response.json()._links.prev.href).toBe("/users?page=1&q=Ana&size=10");
    expect(response.json()._links.next.href).toBe("/users?page=3&q=Ana&size=10");
    expect(response.json()._links.last.href).toBe("/users?page=4&q=Ana&size=10");
  });

  it("gives the owner self/update links without staff links", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("USUARIO", "user-1")),
    });
    const links = response.json()._links;

    expect(response.statusCode).toBe(200);
    expect(links.self.href).toBe("/users/user-1");
    expect(links.update.method).toBe("PATCH");
    expect(links).not.toHaveProperty("collection");
    expect(links).not.toHaveProperty("delete");
    expect(links).not.toHaveProperty("change-role");
  });

  it("returns 403 when a user requests another user's resource", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users/other-user",
      headers: bearerAuth(tokenFor("USUARIO", "user-1")),
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();
  });

  it.each(["BACKOFFICE", "TECNICO"] as const)("limits %s links to collection/update", async (role) => {
    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor(role, `${role.toLowerCase()}-1`)),
    });
    const links = response.json()._links;

    expect(links.collection.href).toBe("/users");
    expect(links.update.method).toBe("PATCH");
    expect(links).not.toHaveProperty("change-role");
    expect(links).not.toHaveProperty("delete");
  });

  it("gives admins change-role and delete links for a non-removed user", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
    });

    expect(response.json()._links.collection.href).toBe("/users");
    expect(response.json()._links.update.method).toBe("PATCH");
    expect(response.json()._links["change-role"].method).toBe("PATCH");
    expect(response.json()._links.delete.method).toBe("DELETE");
  });

  it.each(["BACKOFFICE", "TECNICO"] as const)("blocks %s role escalation before persistence", async (role) => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor(role, `${role.toLowerCase()}-1`)),
      payload: { papel: "ADMINISTRADOR" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("allows an admin role update", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
      payload: { papel: "TECNICO" },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ papel: "TECNICO" }) }),
    );
  });

  it("keeps GET for removed users and omits mutation links", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(makeUser({
      ativo: false,
      anonimizado: true,
      deletadoEm: fixedDate,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
    });
    const links = response.json()._links;

    expect(response.statusCode).toBe(200);
    expect(links.self.href).toBe("/users/user-1");
    expect(links).not.toHaveProperty("update");
    expect(links).not.toHaveProperty("delete");
    expect(links).not.toHaveProperty("change-role");
  });

  it("rejects PATCH on a removed user without reactivating it", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(makeUser({
      ativo: false,
      anonimizado: true,
      deletadoEm: fixedDate,
    }));

    const response = await app.inject({
      method: "PATCH",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
      payload: { ativo: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("keeps admin mutation links for an inactive user not yet soft-deleted", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(makeUser({ ativo: false }));

    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR", "admin-1")),
    });

    expect(response.json()._links.update.method).toBe("PATCH");
    expect(response.json()._links.delete.method).toBe("DELETE");
  });

  it("returns 204 on first delete and 409 on repeat without a second update", async () => {
    const removed = makeUser({ ativo: false, anonimizado: true, deletadoEm: fixedDate });
    prismaMock.usuario.findUnique
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce(removed);
    prismaMock.usuario.update.mockResolvedValueOnce(removed);
    const headers = bearerAuth(tokenFor("ADMINISTRADOR", "admin-1"));

    const first = await app.inject({ method: "DELETE", url: "/users/user-1", headers });
    const second = await app.inject({ method: "DELETE", url: "/users/user-1", headers });

    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");
    expect(second.statusCode).toBe(409);
    expect(prismaMock.usuario.update).toHaveBeenCalledTimes(1);
  });

  it("contracts every returned admin item link", async () => {
    const token = tokenFor("ADMINISTRADOR", "admin-1");
    const response = await app.inject({
      method: "GET",
      url: "/users/user-1",
      headers: bearerAuth(token),
    });
    const links = response.json()._links as Record<string, Link | Link[]>;

    for (const [rel, entry] of Object.entries(links)) {
      const actions = Array.isArray(entry) ? entry : [entry];
      for (const action of actions) {
        let payload: Record<string, unknown> | undefined;
        if (rel === "update") payload = { nome: "Ana Atualizada" };
        if (rel === "change-role") payload = { papel: "TECNICO" };
        const result = await callLink(app, action, token, payload);
        expect(result.statusCode).not.toBe(403);
        expect(result.statusCode).not.toBe(405);
      }
    }
  });

  it.each(["USUARIO", "BACKOFFICE", "TECNICO"] as const)("contracts all returned %s item links", async (role) => {
    const token = tokenFor(role, role === "USUARIO" ? "user-1" : `${role.toLowerCase()}-1`);
    const response = await app.inject({ method: "GET", url: "/users/user-1", headers: bearerAuth(token) });
    const links = response.json()._links as Record<string, Link | Link[]>;

    for (const [rel, entry] of Object.entries(links)) {
      const actions = Array.isArray(entry) ? entry : [entry];
      for (const action of actions) {
        const payload = rel === "update" ? { nome: "Ana Atualizada" } : undefined;
        const result = await callLink(app, action, token, payload);
        expect(result.statusCode).not.toBe(403);
        expect(result.statusCode).not.toBe(405);
      }
    }
  });

  it("contracts every admin collection link, including create", async () => {
    const token = tokenFor("ADMINISTRADOR", "admin-1");
    const response = await app.inject({ method: "GET", url: "/users", headers: bearerAuth(token) });
    const links = response.json()._links as Record<string, Link | Link[]>;
    const createBody = {
      nome: "Novo Usuário",
      emailPessoal: "novo@example.com",
      senha: "StrongPassword123!",
    };

    for (const [rel, entry] of Object.entries(links)) {
      const actions = Array.isArray(entry) ? entry : [entry];
      for (const action of actions) {
        const result = await callLink(app, action, token, rel === "create" ? createBody : undefined);
        expect(result.statusCode).not.toBe(403);
        expect(result.statusCode).not.toBe(405);
      }
    }
  });
});
