import type { FastifyInstance } from "fastify";
import { create, list } from "./messages.controller";

export async function ticketMessagesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);
  app.post("/:id/mensagens", create);
  app.get("/:id/mensagens", list);
}
