import type { FastifyReply, FastifyRequest } from "fastify";
import {
  buildLinks,
  link,
  toCollection,
  toResource,
  type Viewer,
} from "../../hateoas/index.js";
import { ApiError } from "../../hateoas/problem.js";
import {
  ListNotificationsQuerySchema,
  NotificationIdParamsSchema,
  PatchAllNotificationsBodySchema,
  PatchNotificationBodySchema,
} from "./notifications.types.js";
import {
  listNotifications,
  markAllNotificationsAsRead,
  patchNotification,
  createTestNotification,
} from "./notifications.service.js";
import { buildNotificationLinks } from "./notifications.hateoas.js";
import { canViewTicket } from "../tickets/ticket-rules.js";

function getViewer(req: FastifyRequest): Viewer {
  const user = req.user as { id?: string; sub?: string; role?: Viewer["role"] } | undefined;
  const id = user?.id ?? user?.sub;
  if (!id || !user?.role) {
    throw new ApiError("unauthorized", "Usuário não autenticado");
  }
  return { id, role: user.role };
}

/** A listagem consulta os chamados de uma vez, sem divulgar links inacessíveis. */
async function visibleTicketIds(
  req: FastifyRequest,
  viewer: Viewer,
  notifications: Array<{ chamadoId: string | null }>,
): Promise<Set<string>> {
  const ids = [...new Set(notifications.flatMap((item) => item.chamadoId ? [item.chamadoId] : []))];
  if (ids.length === 0) return new Set();
  const tickets = await req.server.prisma.chamado.findMany({
    where: { id: { in: ids }, deletadoEm: null },
    select: { id: true, criadoPorId: true },
  });
  return new Set(tickets.filter((ticket) => canViewTicket(viewer, ticket.criadoPorId)).map((ticket) => ticket.id));
}

export async function listNotificationsHandler(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const viewer = getViewer(req);
  const query = ListNotificationsQuerySchema.parse(req.query);

  const { items, total, unreadCount } = await listNotifications(
    req.server.prisma,
    viewer.id,
    query
  );

  const visible = await visibleTicketIds(req, viewer, items);
  const resources = items.map((item) =>
    toResource(item, buildNotificationLinks(item, viewer, item.chamadoId !== null && visible.has(item.chamadoId)))
  );

  const extraLinks = buildLinks({
    "mark-all-read":
      unreadCount > 0 &&
      link("/notifications", "PATCH", { title: "Marcar todas como lidas" }),
  });

  const collection = toCollection({
    rel: "notifications",
    basePath: "/notifications",
    items: resources,
    page: query.page,
    size: query.size,
    total,
    filters: {
      apenasNaoLidas:
        query.apenasNaoLidas !== undefined ? String(query.apenasNaoLidas) : undefined,
      arquivadas:
        query.arquivadas !== undefined ? String(query.arquivadas) : undefined,
    },
    links: extraLinks,
  });

  return reply.code(200).send(collection);
}

export async function patchNotificationHandler(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const viewer = getViewer(req);
  const { id } = NotificationIdParamsSchema.parse(req.params);
  const body = PatchNotificationBodySchema.parse(req.body);

  const updated = await patchNotification(
    req.server.prisma,
    id,
    viewer.id,
    body
  );

  const visible = await visibleTicketIds(req, viewer, [updated]);
  return reply
    .code(200)
    .send(toResource(updated, buildNotificationLinks(updated, viewer, updated.chamadoId !== null && visible.has(updated.chamadoId))));
}

export async function patchAllNotificationsHandler(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const viewer = getViewer(req);
  PatchAllNotificationsBodySchema.parse(req.body);

  const result = await markAllNotificationsAsRead(req.server.prisma, viewer.id);
  const links = buildLinks({
    self: link("/notifications", "GET"),
  });

  return reply.code(200).send(toResource(result, links));
}

export async function createTestNotificationHandler(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const viewer = getViewer(req);
  const created = await createTestNotification(req.server.prisma, viewer.id);
  const resource = toResource(created, buildNotificationLinks(created, viewer));

  return reply
    .code(201)
    .header("Location", `/notifications/${created.id}`)
    .send(resource);
}
