import type { Prisma, PrismaClient } from "@prisma/client";
import { ApiError } from "../../hateoas/problem.js";
import { toSkipTake } from "../../hateoas/pagination.js";
import type {
  ListNotificationsQuery,
  PatchNotificationBody,
} from "./notifications.types.js";

export async function listNotifications(
  prisma: PrismaClient,
  userId: string,
  query: ListNotificationsQuery
) {
  const { skip, take } = toSkipTake({ page: query.page, size: query.size });

  const where: Prisma.NotificacaoWhereInput = {
    usuarioId: userId,
  };

  if (query.apenasNaoLidas === true) {
    where.lidaEm = null;
  } else if (query.apenasNaoLidas === false) {
    // Quando explicitamente false, não restringe apenas às não lidas
  }

  if (query.arquivadas === true) {
    where.arquivadaEm = { not: null };
  } else if (query.arquivadas === false || query.arquivadas === undefined) {
    where.arquivadaEm = null;
  }

  const [items, total, unreadCount] = await Promise.all([
    prisma.notificacao.findMany({
      where,
      skip,
      take,
      orderBy: { criadoEm: "desc" },
    }),
    prisma.notificacao.count({ where }),
    prisma.notificacao.count({
      where: { usuarioId: userId, lidaEm: null, arquivadaEm: null },
    }),
  ]);

  return { items, total, unreadCount };
}

export async function patchNotification(
  prisma: PrismaClient,
  id: string,
  userId: string,
  body: PatchNotificationBody
) {
  const existing = await prisma.notificacao.findFirst({
    where: { id, usuarioId: userId },
  });

  if (!existing) {
    throw new ApiError("not-found", "Notificação não encontrada");
  }

  const data: Prisma.NotificacaoUpdateInput = {};

  if (body.lida !== undefined) {
    data.lidaEm = body.lida ? new Date() : null;
  }

  if (body.arquivada !== undefined) {
    data.arquivadaEm = body.arquivada ? new Date() : null;
  }

  return prisma.notificacao.update({
    where: { id: existing.id },
    data,
  });
}

export async function markAllNotificationsAsRead(
  prisma: PrismaClient,
  userId: string
) {
  const result = await prisma.notificacao.updateMany({
    where: {
      usuarioId: userId,
      lidaEm: null,
    },
    data: {
      lidaEm: new Date(),
    },
  });

  return { updatedCount: result.count };
}

export async function createTestNotification(
  prisma: PrismaClient,
  userId: string
) {
  return prisma.notificacao.create({
    data: {
      usuarioId: userId,
      titulo: "Notificação de teste",
      mensagem: "Esta é uma notificação de teste do sistema.",
      tipo: "SISTEMA",
      canal: "IN_APP",
      meta: { url: "/dashboard" },
    },
  });
}