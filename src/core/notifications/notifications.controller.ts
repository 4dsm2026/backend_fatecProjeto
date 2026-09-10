import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { sendNotFound, sendReply, sendUnauthorized, sendValidationError } from "../../utils/http";
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
const idValidator   = buildRouteValidator({ params: NotificationIdSchema.shape.params });

/* GET /notifications */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    const page = await listNotifications(prisma, userId, parsed.data!.query!);
    await res.send(page);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar notificações");
    await res.code(500).send({ error: "Erro interno ao listar notificações" });
  }
}

/* POST /notifications/:id/read */
export async function readOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    await markAsRead(prisma, parsed.data!.params!.id, userId);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendNotFound(res, "Notificação");
    req.log.error({ e }, "💥 Erro ao marcar notificação como lida");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/:id/archive */
export async function archive(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    await archiveNotification(prisma, parsed.data!.params!.id, userId);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendNotFound(res, "Notificação");
    req.log.error({ e }, "💥 Erro ao arquivar notificação");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/:id/unarchive */
export async function unarchive(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    await unarchiveNotification(prisma, parsed.data!.params!.id, userId);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendNotFound(res, "Notificação");
    req.log.error({ e }, "💥 Erro ao desarquivar notificação");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/read-all */
export async function readAll(req: FastifyRequest, res: FastifyReply) {
  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    const result = await markAllAsRead(prisma, userId);
    await res.send(result);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao marcar todas como lidas");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /notifications/test */
export async function createTest(req: FastifyRequest, res: FastifyReply) {
  const prisma = req.server.prisma;
  const userId = req.user?.sub as string | undefined;
  if (!userId) return sendUnauthorized(res);

  try {
    const created = await createTestNotification(prisma, userId);
    await res.send(created);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar notificação de teste");
    await res.code(500).send({ error: errMsg(e) });
  }
}
