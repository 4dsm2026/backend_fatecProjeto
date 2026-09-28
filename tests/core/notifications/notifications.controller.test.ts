import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

// ---------------------------------------------------------------------------
// Mock da camada de validação (buildRouteValidator)
// ---------------------------------------------------------------------------
// O controller cria dois validadores no escopo do módulo, na primeira vez em
// que o arquivo é importado (listValidator e idValidator). Fazemos
// buildRouteValidator devolver sempre o MESMO parseMock — isso é seguro
// porque cada teste aqui exercita só um handler por vez, e cada handler usa
// no máximo um validador (list usa o de query; readOne/archive/unarchive
// usam o de :id; readAll/createTest não usam validador nenhum). Nunca dois
// ao mesmo tempo, então não há risco de um teste vazar configuração pro
// validador "errado".
const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("../../../src/utils/zod-helpers", () => ({
    buildRouteValidator: () => ({ parse: parseMock }),
}));

// ---------------------------------------------------------------------------
// Mock da camada de serviço
// ---------------------------------------------------------------------------
vi.mock("../../../src/core/notifications/notifications.service", () => ({
    listNotifications: vi.fn(),
    markAsRead: vi.fn(),
    archiveNotification: vi.fn(),
    unarchiveNotification: vi.fn(),
    markAllAsRead: vi.fn(),
    createTestNotification: vi.fn(),
}));

import {
    list,
    readOne,
    archive,
    unarchive,
    readAll,
    createTest,
} from "../../../src/core/notifications/notifications.controller";
import {
    listNotifications,
    markAsRead,
    archiveNotification,
    unarchiveNotification,
    markAllAsRead,
    createTestNotification,
} from "../../../src/core/notifications/notifications.service";

// ---------------------------------------------------------------------------
// Helpers de mock para req/res do Fastify
// ---------------------------------------------------------------------------
const AUTHENTICATED_USER_ID = "user-123";
const NOTIFICATION_ID = "notification-abc";

function createRequest(options: { userId?: string } = {}) {
    const request = {
        server: { prisma: {} as unknown },
        user: options.userId ? { sub: options.userId } : undefined,
        log: { error: vi.fn() },
    };
    return request as unknown as FastifyRequest & typeof request;
}

function createReply() {
    const reply = {
        code: vi.fn(),
        send: vi.fn(),
    };
    reply.code.mockReturnValue(reply);
    reply.send.mockResolvedValue(undefined);
    return reply as unknown as FastifyReply & typeof reply;
}

// ---------------------------------------------------------------------------
// Tabelas de casos — evita duplicar blocos de teste quase idênticos
// ---------------------------------------------------------------------------

// readOne / archive / unarchive: validam :id, exigem auth, tratam P2025 como 404
const idBasedEndpoints = [
    {
        name: "readOne (POST /notifications/:id/read)",
        handler: readOne,
        serviceFn: markAsRead,
        logMessage: "💥 Erro ao marcar notificação como lida",
    },
    {
        name: "archive (POST /notifications/:id/archive)",
        handler: archive,
        serviceFn: archiveNotification,
        logMessage: "💥 Erro ao arquivar notificação",
    },
    {
        name: "unarchive (POST /notifications/:id/unarchive)",
        handler: unarchive,
        serviceFn: unarchiveNotification,
        logMessage: "💥 Erro ao desarquivar notificação",
    },
];

// readAll / createTest: sem validação de :id, só exigem auth
const userScopedEndpoints = [
    {
        name: "readAll (POST /notifications/read-all)",
        handler: readAll,
        serviceFn: markAllAsRead,
        logMessage: "💥 Erro ao marcar todas como lidas",
    },
    {
        name: "createTest (POST /notifications/test)",
        handler: createTest,
        serviceFn: createTestNotification,
        logMessage: "💥 Erro ao criar notificação de teste",
    },
];

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------
describe("notifications.controller", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe("list (GET /notifications)", () => {
        it("400 — query inválida retorna o erro de validação sem chamar o service", async () => {
            const validationError = { issues: [{ message: "page inválida" }] };
            parseMock.mockReturnValueOnce({ error: validationError });
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await list(req, reply);

            expect(reply.code).toHaveBeenCalledWith(400);
            expect(reply.send).toHaveBeenCalledWith(validationError);
            expect(listNotifications).not.toHaveBeenCalled();
        });

        it("401 — sem usuário autenticado", async () => {
            parseMock.mockReturnValueOnce({ data: { query: {} } });
            const req = createRequest();
            const reply = createReply();

            await list(req, reply);

            expect(reply.code).toHaveBeenCalledWith(401);
            expect(reply.send).toHaveBeenCalledWith({ error: "Não autenticado" });
            expect(listNotifications).not.toHaveBeenCalled();
        });

        it("200 — retorna a página de notificações quando a consulta é válida", async () => {
            const query = { page: 1, pageSize: 20 };
            const page = { items: [], total: 0 };
            parseMock.mockReturnValueOnce({ data: { query } });
            vi.mocked(listNotifications).mockResolvedValueOnce(page as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await list(req, reply);

            expect(listNotifications).toHaveBeenCalledWith(req.server.prisma, AUTHENTICATED_USER_ID, query);
            expect(reply.code).not.toHaveBeenCalled();
            expect(reply.send).toHaveBeenCalledWith(page);
        });

        it("500 — loga o erro e retorna mensagem genérica fixa quando o service falha", async () => {
            parseMock.mockReturnValueOnce({ data: { query: {} } });
            const error = new Error("Falha ao consultar o banco");
            vi.mocked(listNotifications).mockRejectedValueOnce(error as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await list(req, reply);

            expect(req.log.error).toHaveBeenCalledWith({ e: error }, "💥 Erro ao listar notificações");
            expect(reply.code).toHaveBeenCalledWith(500);
            // list() usa uma mensagem FIXA no catch (não usa errMsg como os outros handlers)
            expect(reply.send).toHaveBeenCalledWith({ error: "Erro interno ao listar notificações" });
        });
    });

    describe.each(idBasedEndpoints)("$name", ({ handler, serviceFn, logMessage }) => {
        it("400 — id inválido retorna o erro de validação sem chamar o service", async () => {
            const validationError = { issues: [{ message: "id inválido" }] };
            parseMock.mockReturnValueOnce({ error: validationError });
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(reply.code).toHaveBeenCalledWith(400);
            expect(reply.send).toHaveBeenCalledWith(validationError);
            expect(serviceFn).not.toHaveBeenCalled();
        });

        it("401 — sem usuário autenticado", async () => {
            parseMock.mockReturnValueOnce({ data: { params: { id: NOTIFICATION_ID } } });
            const req = createRequest();
            const reply = createReply();

            await handler(req, reply);

            expect(reply.code).toHaveBeenCalledWith(401);
            expect(reply.send).toHaveBeenCalledWith({ error: "Não autenticado" });
            expect(serviceFn).not.toHaveBeenCalled();
        });

        it("204 — operação bem-sucedida não retorna corpo", async () => {
            parseMock.mockReturnValueOnce({ data: { params: { id: NOTIFICATION_ID } } });
            vi.mocked(serviceFn).mockResolvedValueOnce(undefined as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(serviceFn).toHaveBeenCalledWith(req.server.prisma, NOTIFICATION_ID, AUTHENTICATED_USER_ID);
            expect(reply.code).toHaveBeenCalledWith(204);
            expect(reply.send).toHaveBeenCalledWith();
        });

        it("404 — erro Prisma P2025 é tratado como 'não encontrado', sem logar como falha", async () => {
            parseMock.mockReturnValueOnce({ data: { params: { id: NOTIFICATION_ID } } });
            const notFoundError = Object.assign(new Error("Record not found"), { code: "P2025" });
            vi.mocked(serviceFn).mockRejectedValueOnce(notFoundError as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(reply.code).toHaveBeenCalledWith(404);
            expect(reply.send).toHaveBeenCalledWith({ error: "Notificação não encontrada" });
            expect(req.log.error).not.toHaveBeenCalled();
        });

        it("500 — Error genérico é logado e sua mensagem é devolvida no corpo", async () => {
            parseMock.mockReturnValueOnce({ data: { params: { id: NOTIFICATION_ID } } });
            const error = new Error("Timeout ao acessar o banco");
            vi.mocked(serviceFn).mockRejectedValueOnce(error as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(req.log.error).toHaveBeenCalledWith({ e: error }, logMessage);
            expect(reply.code).toHaveBeenCalledWith(500);
            expect(reply.send).toHaveBeenCalledWith({ error: "Timeout ao acessar o banco" });
        });

        it("500 — valor não-Error lançado pelo service é convertido para string (errMsg)", async () => {
            parseMock.mockReturnValueOnce({ data: { params: { id: NOTIFICATION_ID } } });
            vi.mocked(serviceFn).mockRejectedValueOnce("falha inesperada" as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(reply.code).toHaveBeenCalledWith(500);
            expect(reply.send).toHaveBeenCalledWith({ error: "falha inesperada" });
        });
    });

    describe.each(userScopedEndpoints)("$name", ({ handler, serviceFn, logMessage }) => {
        it("401 — sem usuário autenticado", async () => {
            const req = createRequest();
            const reply = createReply();

            await handler(req, reply);

            expect(reply.code).toHaveBeenCalledWith(401);
            expect(reply.send).toHaveBeenCalledWith({ error: "Não autenticado" });
            expect(serviceFn).not.toHaveBeenCalled();
        });

        it("200 — retorna o resultado do service quando a operação é bem-sucedida", async () => {
            const result = { ok: true };
            vi.mocked(serviceFn).mockResolvedValueOnce(result as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(serviceFn).toHaveBeenCalledWith(req.server.prisma, AUTHENTICATED_USER_ID);
            expect(reply.code).not.toHaveBeenCalled();
            expect(reply.send).toHaveBeenCalledWith(result);
        });

        it("500 — loga o erro e devolve a mensagem do Error lançado pelo service", async () => {
            const error = new Error("Falha inesperada");
            vi.mocked(serviceFn).mockRejectedValueOnce(error as never);
            const req = createRequest({ userId: AUTHENTICATED_USER_ID });
            const reply = createReply();

            await handler(req, reply);

            expect(req.log.error).toHaveBeenCalledWith({ e: error }, logMessage);
            expect(reply.code).toHaveBeenCalledWith(500);
            expect(reply.send).toHaveBeenCalledWith({ error: "Falha inesperada" });
        });
    });
});