import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { NotificationsListSchema, NotificationIdSchema } from "./notifications.types";
import {
  listNotifications,
  markAsRead,
  archiveNotification,
  unarchiveNotification,
  markAllAsRead,
  createTestNotification,
} from "./notifications.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const listValidator = buildRouteValidator({ query: NotificationsListSchema.shape.query });
const idValidator = buildRouteValidator({ params: NotificationIdSchema.shape.params });

const requireUserId = (req: FastifyRequest, res: FastifyReply): string | null => {
  const userId = req.user?.sub as string | undefined;
  if (!userId) {
    void res.code(401).send({ error: "Não autenticado" });
    return null;
  }

  return userId;
};

const validateIdOrBadRequest = async (
  req: FastifyRequest,
  res: FastifyReply,
  parsed: ReturnType<typeof idValidator.parse>,
) => {
  if ("error" in parsed) {
    return res.code(400).send(parsed.error);
  }

  return parsed.data?.params?.id ?? null;
};

/* GET /notifications */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return res.code(400).send(parsed.error);

  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const page = await listNotifications(prisma, userId, parsed.data!.query!);
    return res.send(page);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar notificações");
    return res.code(500).send({ error: "Erro interno ao listar notificações" });
  }
}

/* POST /notifications/:id/read */
export async function readOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  const notificationId = await validateIdOrBadRequest(req, res, parsed);
  if (!notificationId) return;

  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    await markAsRead(prisma, notificationId, userId);
    return res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.code(404).send({ error: "Notificação não encontrada" });
    }

    req.log.error({ e }, "💥 Erro ao marcar notificação como lida");
    return res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/:id/archive */
export async function archive(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  const notificationId = await validateIdOrBadRequest(req, res, parsed);
  if (!notificationId) return;

  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    await archiveNotification(prisma, notificationId, userId);
    return res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.code(404).send({ error: "Notificação não encontrada" });
    }

    req.log.error({ e }, "💥 Erro ao arquivar notificação");
    return res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/:id/unarchive */
export async function unarchive(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  const notificationId = await validateIdOrBadRequest(req, res, parsed);
  if (!notificationId) return;

  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    await unarchiveNotification(prisma, notificationId, userId);
    return res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.code(404).send({ error: "Notificação não encontrada" });
    }

    req.log.error({ e }, "💥 Erro ao desarquivar notificação");
    return res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/read-all */
export async function readAll(req: FastifyRequest, res: FastifyReply) {
  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const result = await markAllAsRead(prisma, userId);
    return res.send(result);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao marcar todas como lidas");
    return res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/test */
export async function createTest(req: FastifyRequest, res: FastifyReply) {
  const prisma = req.server.prisma;
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const created = await createTestNotification(prisma, userId);
    return res.send(created);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar notificação de teste");
    return res.code(500).send({ error: errMsg(e) });
  }
}
