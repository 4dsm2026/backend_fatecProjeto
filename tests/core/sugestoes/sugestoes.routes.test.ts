import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));

import { buildApp } from "../../../src/app";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { bearerAuth, makeAdminToken } from "../../helpers/auth";
import { resetMocks } from "../../helpers/reset";

let app: FastifyInstance;

Object.assign(prismaMock.sugestao, {
  findUnique: vi.fn(),
  updateMany: vi.fn(),
});

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(resetMocks);

describe("suggestion routes", () => {
  const documento = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Texto do documento" }] },
  ] };

  it("persists documento on creation while preserving HAL and Location", async () => {
    prismaMock.sugestao.create.mockImplementationOnce(async ({ data }) => ({
      id: "suggestion-doc", ...data, status: "NAO_RESPONDIDO", resposta: null,
      respostaDocumento: null, criadoEm: new Date(),
    }) as never);
    const response = await app.inject({
      method: "POST", url: "/suggestions", headers: bearerAuth(makeAdminToken()),
      payload: { emailContato: "aluno@example.test", conteudo: "Texto da sugestão", documento },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/suggestions/suggestion-doc");
    expect(response.json()).toMatchObject({ documento, _links: { self: { href: "/suggestions/suggestion-doc" } } });
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ documento }),
    }));
  });

  it("persists respostaDocumento with the atomic response operation", async () => {
    prismaMock.sugestao.findUnique
      .mockResolvedValueOnce({ id: "suggestion-doc", status: "NAO_RESPONDIDO", resposta: null } as never)
      .mockResolvedValueOnce({ id: "suggestion-doc", usuarioId: "user-1", status: "RESPONDIDO", resposta: "Resposta oficial", respostaDocumento: documento } as never);
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    const response = await app.inject({
      method: "PATCH", url: "/suggestions/suggestion-doc", headers: bearerAuth(makeAdminToken()),
      payload: { resposta: "Resposta oficial", respostaDocumento: documento },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ respostaDocumento: documento, _links: { self: { href: "/suggestions/suggestion-doc" } } });
    expect(prismaMock.sugestao.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "suggestion-doc", status: "NAO_RESPONDIDO", resposta: null },
      data: expect.objectContaining({ respostaDocumento: documento, status: "RESPONDIDO" }),
    }));
  });

  it("rejects executable links in documents before writing to the database", async () => {
    const response = await app.inject({
      method: "POST", url: "/suggestions", headers: bearerAuth(makeAdminToken()),
      payload: { emailContato: "aluno@example.test", conteudo: "Texto da sugestão", documento: {
        type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto", marks: [
          { type: "link", attrs: { href: "javascript:alert(1)" } },
        ] }] }],
      } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(prismaMock.sugestao.create).not.toHaveBeenCalled();
  });

  it("documents RFC 7807 for validation and state conflicts", () => {
    const operation = app.swagger().paths?.["/suggestions/{id}"]?.patch;
    expect(operation?.responses?.["400"]).toHaveProperty(
      "content.application/problem+json.schema",
    );
    expect(operation?.responses?.["409"]).toHaveProperty(
      "content.application/problem+json.schema",
    );
    expect(operation?.responses).not.toHaveProperty("422");
  });

  it("returns a 400 RFC 7807 problem for structurally invalid response content", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/suggestions/suggestion-1",
      headers: bearerAuth(makeAdminToken()),
      payload: { resposta: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      type: "/errors/bad-request",
      status: 400,
      instance: "/suggestions/suggestion-1",
      errors: [{ field: "body.resposta" }],
    });
    expect(prismaMock.sugestao.findUnique).not.toHaveBeenCalled();
  });

  it("preserves the service conflict for a suggestion that is already answered", async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce({
      id: "suggestion-1",
      status: "RESPONDIDO",
      resposta: "Resposta anterior",
    } as never);

    const response = await app.inject({
      method: "PATCH",
      url: "/suggestions/suggestion-1",
      headers: bearerAuth(makeAdminToken()),
      payload: { resposta: "Nova resposta" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      type: "/errors/conflict",
      status: 409,
      instance: "/suggestions/suggestion-1",
    });
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled();
  });
});
