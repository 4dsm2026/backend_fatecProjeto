import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));

import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { bearerAuth, makeAdminToken } from "../../helpers/auth";
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

describe("attachment routes", () => {
  it("registers the documented resource and content routes", () => {
    expect(app.hasRoute({ method: "GET", url: "/tickets/:id/attachments" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/tickets/:id/attachments" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/attachments/:anexoId" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/attachments/:anexoId/content" })).toBe(true);
  });

  it("requires authentication on the registered attachment routes", async () => {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/tickets/ticket-1/attachments" }),
      app.inject({ method: "POST", url: "/tickets/ticket-1/attachments" }),
      app.inject({ method: "GET", url: "/attachments/cmj1234567890123456789012" }),
      app.inject({ method: "GET", url: "/attachments/cmj1234567890123456789012/content" }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    for (const response of responses) {
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
  });

  it("serves the documented HAL collection from the registered route", async () => {
    prismaMock.chamado.findFirst.mockResolvedValueOnce({
      id: "ticket-1",
      criadoPorId: "owner-1",
      responsavelId: null,
      setorId: null,
    } as never);
    prismaMock.anexo.count.mockResolvedValueOnce(1);
    prismaMock.anexo.findMany.mockResolvedValueOnce([{
      id: "cmj1234567890123456789012",
      chamadoId: "ticket-1",
      enviadoPorId: "owner-1",
      nomeArquivo: "arquivo.pdf",
      mimeType: "application/pdf",
      tamanhoBytes: 120,
      enviadoEm: new Date("2026-01-01T00:00:00.000Z"),
      enviadoPor: { id: "owner-1", nome: "Usuário" },
    }] as never);

    const response = await app.inject({
      method: "GET",
      url: "/tickets/ticket-1/attachments?page=0&size=10",
      headers: bearerAuth(makeAdminToken()),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      _embedded: {
        attachments: [{
          id: "cmj1234567890123456789012",
          _links: {
            self: { href: "/attachments/cmj1234567890123456789012", method: "GET" },
            content: { href: "/attachments/cmj1234567890123456789012/content", method: "GET" },
            collection: { href: "/tickets/ticket-1/attachments", method: "GET" },
          },
        }],
      },
      page: { number: 0, size: 10, totalElements: 1, totalPages: 1 },
    });
  });

  it("documents upload success with HAL, Location, and RFC 7807 errors", () => {
    const operation = app.swagger().paths?.["/tickets/{id}/attachments"]?.post;
    expect(operation?.responses?.["201"]).toMatchObject({
      description: "Anexo criado.",
      headers: { Location: expect.any(Object) },
      content: {
        "application/json": {
          schema: {
            properties: {
              _links: expect.any(Object),
            },
          },
        },
      },
    });
    expect(operation?.responses?.["413"]).toHaveProperty(
      "content.application/problem+json.schema",
    );
    expect(operation?.responses?.["415"]).toHaveProperty(
      "content.application/problem+json.schema",
    );
  });

  it("converts list failures into an RFC 7807 response", async () => {
    prismaMock.chamado.findFirst.mockResolvedValueOnce({
      id: "ticket-1",
      criadoPorId: "owner-1",
      responsavelId: null,
      setorId: null,
    } as never);
    prismaMock.anexo.count.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await app.inject({
      method: "GET",
      url: "/tickets/ticket-1/attachments?page=1&size=5",
      headers: bearerAuth(makeAdminToken()),
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      type: "/errors/internal",
      status: 500,
      instance: "/tickets/ticket-1/attachments",
    });
    expect(response.json().detail).toBeUndefined();
  });

  it("converts download failures into an RFC 7807 response", async () => {
    prismaMock.anexo.findUnique.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await app.inject({
      method: "GET",
      url: "/attachments/cmj1234567890123456789012/content",
      headers: bearerAuth(makeAdminToken()),
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      type: "/errors/internal",
      status: 500,
      instance: "/attachments/cmj1234567890123456789012/content",
    });
    expect(response.json().detail).toBeUndefined();
  });

  it("does not register the superseded Portuguese routes", () => {
    expect(app.hasRoute({ method: "GET", url: "/tickets/:id/anexos" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/anexos/:anexoId/download" })).toBe(false);
  });
});
