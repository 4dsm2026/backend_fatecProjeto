import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));

import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { bearerAuth, makeAdminToken, makeUserToken } from "../../helpers/auth";
import { resetMocks } from "../../helpers/reset";

let app: FastifyInstance;

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
              collection: { href: "/admin/audit-logs", method: "GET" },
              actor: { href: "/usuarios/user-1", method: "GET" },
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
      feitoPorId: "admin-1",
      feitoEm: new Date("2026-01-02T00:00:00.000Z"),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/admin/audit-logs",
      headers: bearerAuth(makeAdminToken()),
      payload: { acao: "MANUAL" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "log-2",
      _links: {
        collection: { href: "/admin/audit-logs", method: "GET" },
        actor: { href: "/usuarios/admin-1", method: "GET" },
      },
    });
  });
});
