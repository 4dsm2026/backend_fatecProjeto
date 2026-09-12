import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// notifications.routes.ts é código de "fiação": registra hooks e rotas no
// Fastify, sem lógica de negócio (sem if/else, sem loop). Não há branches
// para cobrir aqui — o valor deste teste está em garantir que:
//
//   1) o hook de autenticação está sempre registrado (se sumir sem querer,
//      a rota inteira vira pública silenciosamente — regressão de
//      segurança grave e fácil de não notar);
//   2) cada rota está ligada ao handler certo, com o verbo HTTP certo
//      (protege contra erro de copiar/colar ao adicionar rotas parecidas).
//
// A verificação de que a rota FUNCIONA de ponta a ponta (autentica de
// verdade, chama o handler certo, devolve o status certo) já é feita nos
// testes de integração existentes (ex.: tests/produtos/05-autorizacao.test.ts,
// que já bate em PATCH /notifications/:id/lida de verdade). Este arquivo
// cobre só a fiação, isolado — complementa aqueles testes, não substitui.
//
// notifications.service.ts é mockado por precaução (evita qualquer
// dependência do Prisma estar gerado — mesmo que, neste arquivo, nenhuma
// função de service chegue a ser executada de fato, já que só comparamos
// referências, nunca invocamos os handlers).
//
// ⚠️ Ajuste os caminhos de import abaixo se a estrutura do projeto for
// diferente. Assumi este arquivo em:
//   tests/coreTeste/notifications/notifications.routes.test.ts
// ---------------------------------------------------------------------------

vi.mock("../../../src/core/notifications/notifications.service", () => ({
  listNotifications: vi.fn(),
  markAsRead: vi.fn(),
  archiveNotification: vi.fn(),
  unarchiveNotification: vi.fn(),
  markAllAsRead: vi.fn(),
  createTestNotification: vi.fn(),
}));

import { notificationsRoutes } from "../../../src/core/notifications/notifications.routes";
import {
  list,
  readOne,
  archive,
  unarchive,
  readAll,
  createTest,
} from "../../../src/core/notifications/notifications.controller";

// ---------------------------------------------------------------------------
// Mock mínimo de FastifyInstance — só os métodos que este arquivo usa.
// ---------------------------------------------------------------------------
function createMockApp() {
  const app = {
    authenticate: vi.fn(),
    addHook: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };
  return app as unknown as FastifyInstance & typeof app;
}

// ---------------------------------------------------------------------------
// Tabela de rotas esperadas — uma linha por rota, evita duplicar 6 blocos
// de teste quase idênticos.
// ---------------------------------------------------------------------------
type RouteHandler = typeof list;

type RouteCase = {
  description: string;
  method: "get" | "post" | "patch";
  path: string;
  handler: RouteHandler;
};

const routeCases: RouteCase[] = [
  { description: "GET / → list", method: "get", path: "/", handler: list },
  { description: "POST /read-all → readAll", method: "post", path: "/read-all", handler: readAll },
  { description: "POST /test → createTest", method: "post", path: "/test", handler: createTest },
  { description: "PATCH /:id/lida → readOne", method: "patch", path: "/:id/lida", handler: readOne },
  { description: "POST /:id/archive → archive", method: "post", path: "/:id/archive", handler: archive },
  { description: "POST /:id/unarchive → unarchive", method: "post", path: "/:id/unarchive", handler: unarchive },
];

describe("notificationsRoutes", () => {
  it("registra o hook de autenticação (preHandler) usando app.authenticate", async () => {
    const app = createMockApp();

    await notificationsRoutes(app);

    expect(app.addHook).toHaveBeenCalledTimes(1);
    expect(app.addHook).toHaveBeenCalledWith("preHandler", app.authenticate);
  });

  it.each(routeCases)("$description", async ({ method, path, handler }) => {
    const app = createMockApp();

    await notificationsRoutes(app);

    expect(app[method]).toHaveBeenCalledWith(path, handler);
  });

  it("não registra nenhuma rota ou hook além dos esperados (protege contra rota extra silenciosa)", async () => {
    const app = createMockApp();

    await notificationsRoutes(app);

    const expectedCountByMethod = routeCases.reduce<Record<"get" | "post" | "patch", number>>(
      (counts, { method }) => {
        counts[method] += 1;
        return counts;
      },
      { get: 0, post: 0, patch: 0 },
    );

    expect(app.get).toHaveBeenCalledTimes(expectedCountByMethod.get);
    expect(app.post).toHaveBeenCalledTimes(expectedCountByMethod.post);
    expect(app.patch).toHaveBeenCalledTimes(expectedCountByMethod.patch);
    expect(app.addHook).toHaveBeenCalledTimes(1);
  });
});