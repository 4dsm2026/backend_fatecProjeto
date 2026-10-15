import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  buildNotificationLinks,
  type NotificationRecord,
} from "../../../src/core/notifications/notifications.hateoas.js";
import {
  createTestNotificationHandler,
  listNotificationsHandler,
  patchAllNotificationsHandler,
  patchNotificationHandler,
} from "../../../src/core/notifications/notifications.controller.js";

function makeNotification(
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord {
  return {
    id: "n-1",
    usuarioId: "usr-1",
    titulo: "Chamado atualizado",
    mensagem: "Seu chamado recebeu uma resposta.",
    tipo: "MENSAGEM_NOVA",
    canal: "IN_APP",
    criadoEm: new Date("2026-10-12T12:00:00.000Z"),
    lidaEm: null,
    arquivadaEm: null,
    chamadoId: null,
    ...overrides,
  };
}

function createMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe("notifications.hateoas — Matriz de Estados e Links", () => {
  it("notificação não lida e não arquivada traz mark-read e archive, omitindo mark-unread e unarchive", () => {
    const links = buildNotificationLinks(
      makeNotification({ lidaEm: null, arquivadaEm: null, chamadoId: null })
    );

    expect(links.self).toEqual({ href: "/notifications/n-1", method: "GET" });
    expect(links["mark-read"]).toEqual({
      href: "/notifications/n-1",
      method: "PATCH",
      title: "Marcar como lida",
    });
    expect(links["mark-unread"]).toBeUndefined();
    expect(links.archive).toEqual({
      href: "/notifications/n-1",
      method: "PATCH",
      title: "Arquivar",
    });
    expect(links.unarchive).toBeUndefined();
    expect(links.ticket).toBeUndefined();
  });

  it("notificação lida e arquivada traz mark-unread e unarchive, omitindo mark-read e archive", () => {
    const links = buildNotificationLinks(
      makeNotification({
        lidaEm: new Date(),
        arquivadaEm: new Date(),
        chamadoId: null,
      })
    );

    expect(links["mark-unread"]).toEqual({
      href: "/notifications/n-1",
      method: "PATCH",
      title: "Marcar como não lida",
    });
    expect(links["mark-read"]).toBeUndefined();
    expect(links.unarchive).toEqual({
      href: "/notifications/n-1",
      method: "PATCH",
      title: "Desarquivar",
    });
    expect(links.archive).toBeUndefined();
  });

  it("inclui link ticket apenas quando chamadoId existe e canViewTicket é true", () => {
    const withTicket = buildNotificationLinks(
      makeNotification({ chamadoId: "tck-99" }),
      { id: "usr-1", role: "USUARIO" },
      true
    );
    expect(withTicket.ticket).toEqual({
      href: "/tickets/tck-99",
      method: "GET",
      title: "Ver chamado",
    });

    const forbiddenTicket = buildNotificationLinks(
      makeNotification({ chamadoId: "tck-99" }),
      { id: "usr-1", role: "USUARIO" },
      false
    );
    expect(forbiddenTicket.ticket).toBeUndefined();
  });
});

describe("notifications.controller", () => {
  it("GET /notifications retorna coleção HAL com mark-all-read quando há não lidas", async () => {
    const item = makeNotification({ id: "n-10", lidaEm: null });
    const req = {
      user: { id: "usr-1", role: "USUARIO" },
      query: { page: "0", size: "20" },
      server: {
        prisma: {
          notificacao: {
            findMany: vi.fn().mockResolvedValue([item]),
            count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await listNotificationsHandler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        _embedded: {
          notifications: [
            expect.objectContaining({
              id: "n-10",
              _links: expect.objectContaining({
                self: { href: "/notifications/n-10", method: "GET" },
                "mark-read": expect.objectContaining({ method: "PATCH" }),
              }),
            }),
          ],
        },
        page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
        _links: expect.objectContaining({
          "mark-all-read": {
            href: "/notifications",
            method: "PATCH",
            title: "Marcar todas como lidas",
          },
        }),
      })
    );
  });

  it("GET /notifications omite mark-all-read quando unreadCount é 0", async () => {
    const req = {
      user: { id: "usr-1", role: "USUARIO" },
      query: { page: "0", size: "20" },
      server: {
        prisma: {
          notificacao: {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await listNotificationsHandler(req, reply);

    const payload = vi.mocked(reply.send).mock.calls[0]?.[0] as {
      _links: Record<string, unknown>;
    };
    expect(payload._links["mark-all-read"]).toBeUndefined();
  });

  it("PATCH /notifications/:id atualiza estado e recalcula _links", async () => {
    const existing = makeNotification({ id: "n-1", lidaEm: null });
    const updated = makeNotification({ id: "n-1", lidaEm: new Date() });

    const req = {
      user: { id: "usr-1", role: "USUARIO" },
      params: { id: "n-1" },
      body: { lida: true },
      server: {
        prisma: {
          notificacao: {
            findFirst: vi.fn().mockResolvedValue(existing),
            update: vi.fn().mockResolvedValue(updated),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await patchNotificationHandler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "n-1",
        _links: expect.objectContaining({
          "mark-unread": expect.objectContaining({ method: "PATCH" }),
        }),
      })
    );
  });

  it("PATCH /notifications marca todas como lidas e retorna updatedCount com _links", async () => {
    const req = {
      user: { id: "usr-1", role: "USUARIO" },
      body: { lida: true },
      server: {
        prisma: {
          notificacao: {
            updateMany: vi.fn().mockResolvedValue({ count: 5 }),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await patchAllNotificationsHandler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      updatedCount: 5,
      _links: {
        self: { href: "/notifications", method: "GET" },
      },
    });
  });

  it("POST /notifications/test retorna 201 Created com header Location e recurso HAL", async () => {
    const created = makeNotification({ id: "n-test" });
    const req = {
      user: { id: "usr-1", role: "USUARIO" },
      server: {
        prisma: {
          notificacao: {
            create: vi.fn().mockResolvedValue(created),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await createTestNotificationHandler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.header).toHaveBeenCalledWith(
      "Location",
      "/notifications/n-test"
    );
  });
});