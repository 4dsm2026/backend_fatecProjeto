import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));

import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { bearerAuth, makeAdminToken, makeUserToken } from "../../helpers/auth";
import { resetMocks } from "../../helpers/reset";

let app: FastifyInstance;
const mockAuditFindUnique = vi.fn();
Object.assign(prismaMock.auditoria, { findUnique: mockAuditFindUnique });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(resetMocks);

describe("GET /admin/audit-logs", () => {
  it("returns a paginated HAL collection to administrators", async () => {
    const entry = {
      id: "log-1",
      acao: "LOGIN_SUCESSO",
      alvo: null,
      meta: null,
      feitoPorId: "user-1",
      feitoEm: new Date("2026-01-01T00:00:00.000Z"),
      feitoPor: { id: "user-1", nome: "Usuário", ra: "123" },
    };
    prismaMock.auditoria.count.mockResolvedValueOnce(1);
    prismaMock.auditoria.findMany.mockResolvedValueOnce([entry] as never);

    const response = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?page=0&size=10&userId=user-1",
      headers: bearerAuth(makeAdminToken()),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      _embedded: {
        "audit-logs": [
          {
            id: "log-1",
            _links: {
              self: { href: "/admin/audit-logs/log-1", method: "GET" },
              collection: { href: "/admin/audit-logs", method: "GET" },
              actor: { href: "/users/user-1", method: "GET" },
            },
          },
        ],
      },
      page: { size: 10, number: 0, totalElements: 1, totalPages: 1 },
      _links: {
        self: { href: "/admin/audit-logs?page=0&size=10&userId=user-1" },
        create: { href: "/admin/audit-logs", method: "POST" },
      },
    });
  });

  it("does not expose audit history to a non-administrator", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
      headers: bearerAuth(makeUserToken()),
    });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.auditoria.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /admin/audit-logs", () => {
  it("creates an entry and returns its available links", async () => {
    prismaMock.auditoria.create.mockResolvedValueOnce({
      id: "log-2",
      acao: "MANUAL",
      alvo: null,
      meta: null,
      feitoPorId: "admin-id-001",
      feitoEm: new Date("2026-01-02T00:00:00.000Z"),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/admin/audit-logs",
      headers: bearerAuth(makeAdminToken()),
      payload: { acao: "MANUAL", feitoPorId: "spoofed-user" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/admin/audit-logs/log-2");
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ feitoPorId: "admin-id-001" }),
    }));
    expect(response.json()).toMatchObject({
      id: "log-2",
      _links: {
        self: { href: "/admin/audit-logs/log-2", method: "GET" },
        collection: { href: "/admin/audit-logs", method: "GET" },
        actor: { href: "/users/admin-id-001", method: "GET" },
      },
    });
  });

  describe("GET /admin/audit-logs/:id", () => {
    it("returns an individual record and its valid actor link", async () => {
      mockAuditFindUnique.mockResolvedValueOnce({
        id: "log-3",
        acao: "LOGIN",
        alvo: null,
        meta: null,
        feitoPorId: "user-1",
        feitoEm: new Date("2026-01-03T00:00:00.000Z"),
        feitoPor: { id: "user-1", nome: "Usuário", ra: null },
      } as never);

      const response = await app.inject({
        method: "GET",
        url: "/admin/audit-logs/log-3",
        headers: bearerAuth(makeAdminToken()),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()._links).toMatchObject({
        self: { href: "/admin/audit-logs/log-3", method: "GET" },
        collection: { href: "/admin/audit-logs", method: "GET" },
        actor: { href: "/users/user-1", method: "GET" },
      });
      expect(app.hasRoute({ method: "GET", url: "/users/:id" })).toBe(true);
    });
  });
});
