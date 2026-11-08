import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Link, Role } from "../../../src/hateoas/types";
import { registerProblemHandler } from "../../../src/hateoas";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import authVerify from "../../../src/plugins/auth-verify";
import prismaPlugin from "../../../src/plugins/prisma";
import { bearerAuth, makeAdminToken, makeUserToken } from "../../helpers/auth";
import { papeisRoutes } from "../../../src/core/papeis/papeis.routes";

vi.mock("../../../src/lib/prisma");

type RoleItem = {
  id: string;
  nome: string;
  descricao: string | null;
  _count: { usuarioSetores: number };
};

function makeRole(changes: Partial<RoleItem> = {}): RoleItem {
  return {
    id: "role-1",
    nome: "Coordenador",
    descricao: "Coordena o setor",
    _count: { usuarioSetores: 0 },
    ...changes,
  };
}

function tokenFor(role: Role): string {
  if (role === "ADMINISTRADOR") return makeAdminToken({ sub: "admin-1" });
  return makeUserToken({ sub: `${role.toLowerCase()}-1`, role });
}

async function callLink(app: FastifyInstance, item: Link, token: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: item.method ?? "GET",
    url: item.href,
    headers: bearerAuth(token),
    ...(payload ? { payload } : {}),
  });
}

Object.assign(prismaMock.papelCatalogo, { count: vi.fn(), deleteMany: vi.fn() });

function resetPrismaMocks(): void {
  vi.resetAllMocks();
  prismaMock.$connect.mockResolvedValue(undefined);
  prismaMock.$disconnect.mockResolvedValue(undefined);
  prismaMock.$queryRaw.mockResolvedValue([{ 1: 1 }]);
  prismaMock.papelCatalogo.findMany.mockResolvedValue([makeRole()]);
  prismaMock.papelCatalogo.count.mockResolvedValue(45);
  prismaMock.papelCatalogo.findUnique.mockResolvedValue(makeRole());
  prismaMock.papelCatalogo.create.mockResolvedValue(makeRole({ id: "role-created" }));
  prismaMock.papelCatalogo.update.mockResolvedValue(makeRole());
  prismaMock.papelCatalogo.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.usuarioSetor.count.mockResolvedValue(0);
}

const nonAdminRoles = ["USUARIO", "BACKOFFICE", "TECNICO"] as const;
const protectedRoutes = [
  { method: "GET", url: "/admin/roles" },
  { method: "POST", url: "/admin/roles", payload: { nome: "Coordenador" } },
  { method: "GET", url: "/admin/roles/role-1" },
  { method: "PATCH", url: "/admin/roles/role-1", payload: { nome: "Coordenador novo" } },
  { method: "DELETE", url: "/admin/roles/role-1" },
] as const;

const forbiddenRequests = nonAdminRoles.flatMap((role) =>
  protectedRoutes.map((route) => ({ role, ...route })),
);

let app: FastifyInstance;

beforeAll(async () => {
  resetPrismaMocks();
  app = Fastify({ logger: false });
  await app.register(prismaPlugin);
  await app.register(authVerify);
  registerProblemHandler(app);
  await app.register(papeisRoutes, { prefix: "/admin" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetPrismaMocks();
});

describe("admin roles HAL routes", () => {
  it("returns a paginated HAL collection with defaults and role resources", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/roles",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body._embedded.roles).toHaveLength(1);
    expect(body.page).toEqual({ size: 20, number: 0, totalElements: 45, totalPages: 3 });
    expect(body._embedded.roles[0]).toMatchObject({
      id: "role-1",
      nome: "Coordenador",
      descricao: "Coordena o setor",
      _links: {
        self: { href: "/admin/roles/role-1", method: "GET" },
        collection: { href: "/admin/roles", method: "GET" },
        update: { href: "/admin/roles/role-1", method: "PATCH" },
        delete: { href: "/admin/roles/role-1", method: "DELETE" },
      },
    });
    expect(body._embedded.roles[0]).not.toHaveProperty("_count");
    expect(body._links.create).toEqual({ href: "/admin/roles", method: "POST" });
    expect(prismaMock.papelCatalogo.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });

  it("validates page boundaries and accepts the maximum page size", async () => {
    const headers = bearerAuth(tokenFor("ADMINISTRADOR"));
    const maximum = await app.inject({ method: "GET", url: "/admin/roles?page=0&size=100", headers });
    const negativePage = await app.inject({ method: "GET", url: "/admin/roles?page=-1", headers });
    const oversizedPage = await app.inject({ method: "GET", url: "/admin/roles?size=101", headers });

    expect(maximum.statusCode).toBe(200);
    expect(prismaMock.papelCatalogo.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ skip: 0, take: 100 }),
    );
    expect(negativePage.statusCode).toBe(400);
    expect(oversizedPage.statusCode).toBe(400);
  });

  it("preserves prev, next and last navigation on a middle page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/roles?page=2&size=10",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.json()._links.prev.href).toBe("/admin/roles?page=1&size=10");
    expect(response.json()._links.next.href).toBe("/admin/roles?page=3&size=10");
    expect(response.json()._links.last.href).toBe("/admin/roles?page=4&size=10");
  });

  it.each([0, 2])("includes delete only when relation count is %i", async (linksCount) => {
    prismaMock.papelCatalogo.findUnique.mockResolvedValue(makeRole({ _count: { usuarioSetores: linksCount } }));

    const response = await app.inject({
      method: "GET",
      url: "/admin/roles/role-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });
    const resource = response.json();

    expect(response.statusCode).toBe(200);
    expect(resource).toMatchObject({ id: "role-1", nome: "Coordenador", descricao: "Coordena o setor" });
    expect(resource._links.self.href).toBe("/admin/roles/role-1");
    expect(resource._links.collection.href).toBe("/admin/roles");
    expect(resource._links.update.method).toBe("PATCH");
    expect(Boolean(resource._links.delete)).toBe(linksCount === 0);
    expect(prismaMock.papelCatalogo.findUnique).toHaveBeenCalledWith({
      where: { id: "role-1" },
      include: { _count: { select: { usuarioSetores: true } } },
    });
  });

  it("creates a HAL resource with 201 and its Location", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/roles",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { nome: "Coordenador" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/admin/roles/role-created");
    expect(response.json()._links.self.href).toBe("/admin/roles/role-created");
  });

  it("updates an existing role and returns HAL links", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/roles/role-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { nome: "Coordenador atualizado" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()._links.self.href).toBe("/admin/roles/role-1");
    expect(prismaMock.papelCatalogo.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "role-1" },
      data: { nome: "Coordenador atualizado" },
    }));
  });

  it("deletes an unlinked role with 204 and no response body", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/admin/roles/role-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(prismaMock.papelCatalogo.deleteMany).toHaveBeenCalledWith({
      where: { id: "role-1", usuarioSetores: { none: {} } },
    });
    expect(prismaMock.papelCatalogo.findUnique).not.toHaveBeenCalled();
  });

  it("returns RFC 7807 conflict without deleting a linked role", async () => {
    prismaMock.papelCatalogo.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.papelCatalogo.findUnique.mockResolvedValue(makeRole({ _count: { usuarioSetores: 1 } }));

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/roles/role-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ type: "/errors/conflict", status: 409 });
    expect(prismaMock.papelCatalogo.deleteMany).toHaveBeenCalledWith({
      where: { id: "role-1", usuarioSetores: { none: {} } },
    });
  });

  it("returns 404 when DELETE targets an unknown role", async () => {
    prismaMock.papelCatalogo.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.papelCatalogo.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: "DELETE",
      url: "/admin/roles/missing",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ type: "/errors/not-found", status: 404 });
  });

  it("returns a HAL resource when GET targets an existing role", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/roles/role-1",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "role-1",
      _links: { self: { href: "/admin/roles/role-1", method: "GET" } },
    });
  });

  it("returns 404 when GET targets an unknown role", async () => {
    prismaMock.papelCatalogo.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/admin/roles/missing",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ type: "/errors/not-found", status: 404 });
  });

  it("returns 404 when PATCH targets an unknown role", async () => {
    prismaMock.papelCatalogo.update.mockRejectedValue(
      Object.assign(new Error("Record not found"), { code: "P2025" }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/roles/missing",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { nome: "Atualizado" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ type: "/errors/not-found", status: 404 });
  });

  it("returns 400 Problem errors for invalid POST and PATCH bodies", async () => {
    const headers = bearerAuth(tokenFor("ADMINISTRADOR"));
    const invalidCreate = await app.inject({ method: "POST", url: "/admin/roles", headers, payload: {} });
    const invalidUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/roles/role-1",
      headers,
      payload: { nome: "x" },
    });

    for (const response of [invalidCreate, invalidUpdate]) {
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json().errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: "nome", message: expect.any(String) }),
      ]));
    }
    expect(prismaMock.papelCatalogo.create).not.toHaveBeenCalled();
    expect(prismaMock.papelCatalogo.update).not.toHaveBeenCalled();
  });

  it("returns conflict for duplicate role names on POST and PATCH", async () => {
    const duplicateName = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prismaMock.papelCatalogo.create.mockRejectedValueOnce(duplicateName);
    prismaMock.papelCatalogo.update.mockRejectedValueOnce(duplicateName);
    const headers = bearerAuth(tokenFor("ADMINISTRADOR"));
    const duplicateCreate = await app.inject({
      method: "POST",
      url: "/admin/roles",
      headers,
      payload: { nome: "Coordenador" },
    });
    const duplicateUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/roles/role-1",
      headers,
      payload: { nome: "Coordenador" },
    });

    for (const response of [duplicateCreate, duplicateUpdate]) {
      expect(response.statusCode).toBe(409);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ type: "/errors/conflict", status: 409 });
    }
  });

  it.each(forbiddenRequests)("returns 403 for $role on $method $url without database writes", async (route) => {
    const response = await app.inject({
      method: route.method,
      url: route.url,
      headers: bearerAuth(tokenFor(route.role)),
      ...("payload" in route ? { payload: route.payload } : {}),
    });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.papelCatalogo.create).not.toHaveBeenCalled();
    expect(prismaMock.papelCatalogo.update).not.toHaveBeenCalled();
    expect(prismaMock.papelCatalogo.delete).not.toHaveBeenCalled();
  });

  it("contracts every returned item link for the administrator", async () => {
    const token = tokenFor("ADMINISTRADOR");
    const response = await app.inject({
      method: "GET",
      url: "/admin/roles/role-1",
      headers: bearerAuth(token),
    });
    const links = response.json()._links as Record<string, Link | Link[]>;

    for (const entry of Object.values(links)) {
      for (const action of Array.isArray(entry) ? entry : [entry]) {
        const payload = action.method === "PATCH" ? { nome: "Atualizado" } : undefined;
        const result = await callLink(app, action, token, payload);
        expect(result.statusCode).not.toBe(403);
        expect(result.statusCode).not.toBe(405);
      }
    }
  });

  it("contracts every returned collection link including create", async () => {
    const token = tokenFor("ADMINISTRADOR");
    const response = await app.inject({ method: "GET", url: "/admin/roles", headers: bearerAuth(token) });
    const links = response.json()._links as Record<string, Link | Link[]>;

    for (const [rel, entry] of Object.entries(links)) {
      for (const action of Array.isArray(entry) ? entry : [entry]) {
        const payload = rel === "create" ? { nome: "Novo papel" } : undefined;
        const result = await callLink(app, action, token, payload);
        expect(result.statusCode).not.toBe(403);
        expect(result.statusCode).not.toBe(405);
      }
    }
  });
});
