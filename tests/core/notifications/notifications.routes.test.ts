import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { notificationsRoutes } from "../../../src/core/notifications/notifications.routes.js";

describe("notifications.routes — Registro REST Nível 3", () => {
  it("registra apenas rotas sem verbos na URL (GET /, PATCH /, PATCH /:id, POST /test)", async () => {
    const registered: Array<{ method: string; path: string }> = [];

    const app = {
      authenticate: vi.fn(),
      addHook: vi.fn(),
      setValidatorCompiler: vi.fn(),
      setSerializerCompiler: vi.fn(),
      get: vi.fn((path: string) => registered.push({ method: "GET", path })),
      patch: vi.fn((path: string) =>
        registered.push({ method: "PATCH", path })
      ),
      post: vi.fn((path: string) => registered.push({ method: "POST", path })),
    } as unknown as FastifyInstance;

    await notificationsRoutes(app);

    expect(registered).toEqual([
      { method: "GET", path: "/" },
      { method: "PATCH", path: "/" },
      { method: "PATCH", path: "/:id" },
      { method: "POST", path: "/test" },
    ]);
  });
});