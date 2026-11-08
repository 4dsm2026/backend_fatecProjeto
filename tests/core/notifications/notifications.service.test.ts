import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createTestNotification,
  listNotifications,
  markAllNotificationsAsRead,
  patchNotification,
} from "../../../src/core/notifications/notifications.service.js";
import { ApiError } from "../../../src/hateoas/problem.js";

function createMockPrisma() {
  return {
    notificacao: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("notifications.service", () => {
  it("lista notificações do próprio usuário com paginação base 0", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.notificacao.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificacao.count)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(3);

    const result = await listNotifications(prisma, "user-1", {
      page: 1,
      size: 10,
      apenasNaoLidas: true,
      arquivadas: false,
    });

    expect(prisma.notificacao.findMany).toHaveBeenCalledWith({
      where: {
        usuarioId: "user-1",
        lidaEm: null,
        arquivadaEm: null,
      },
      skip: 10,
      take: 10,
      orderBy: { criadoEm: "desc" },
    });
    expect(result).toEqual({ items: [], total: 15, unreadCount: 3 });
  });

  it("não aplica filtro lidaEm: null quando apenasNaoLidas é false (Bug S7)", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.notificacao.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificacao.count).mockResolvedValue(0);

    await listNotifications(prisma, "user-1", {
      page: 0,
      size: 20,
      apenasNaoLidas: false,
      arquivadas: true,
    });

    expect(prisma.notificacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuarioId: "user-1",
          arquivadaEm: { not: null },
        },
        skip: 0,
        take: 20,
      })
    );
  });

  it("atualiza lidaEm e arquivadaEm corretamente via patchNotification", async () => {
    const prisma = createMockPrisma();
    const existing = { id: "n-1", usuarioId: "user-1" };
    vi.mocked(prisma.notificacao.findFirst).mockResolvedValue(existing as never);
    vi.mocked(prisma.notificacao.update).mockImplementation(
      ({ data }) => Promise.resolve({ ...existing, ...data }) as never
    );

    const readResult = await patchNotification(prisma, "n-1", "user-1", {
      lida: true,
      arquivada: true,
    });

    expect(readResult.lidaEm).toBeInstanceOf(Date);
    expect(readResult.arquivadaEm).toBeInstanceOf(Date);

    const unreadResult = await patchNotification(prisma, "n-1", "user-1", {
      lida: false,
      arquivada: false,
    });

    expect(unreadResult.lidaEm).toBeNull();
    expect(unreadResult.arquivadaEm).toBeNull();
  });

  it("lança ApiError 404 (not-found) se a notificação não existir ou pertencer a outro usuário (IDOR)", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.notificacao.findFirst).mockResolvedValue(null);

    await expect(
      patchNotification(prisma, "notif-de-outro-user", "user-a", { lida: true })
    ).rejects.toThrowError(ApiError);

    expect(prisma.notificacao.findFirst).toHaveBeenCalledWith({
      where: { id: "notif-de-outro-user", usuarioId: "user-a" },
    });
    expect(prisma.notificacao.update).not.toHaveBeenCalled();
  });

  it("marca todas as notificações não lidas do usuário como lidas", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.notificacao.updateMany).mockResolvedValue({ count: 4 });

    const res = await markAllNotificationsAsRead(prisma, "user-1");

    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: "user-1", lidaEm: null },
      data: { lidaEm: expect.any(Date) },
    });
    expect(res).toEqual({ updatedCount: 4 });
  });

  it("cria notificação de teste para o usuário autenticado", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.notificacao.create).mockResolvedValue({
      id: "test-1",
      usuarioId: "user-1",
    } as never);

    const created = await createTestNotification(prisma, "user-1");
    expect(created.id).toBe("test-1");
    expect(prisma.notificacao.create).toHaveBeenCalledOnce();
  });
});