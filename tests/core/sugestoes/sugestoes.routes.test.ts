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
