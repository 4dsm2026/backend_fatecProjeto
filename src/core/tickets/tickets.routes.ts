import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft } from "./tickets.controller.js";
import { ticketMessagesRoutes } from "../ticket-messages/messages.routes.js";

export async function ticketsRoutes(app: FastifyInstance) {
  // tudo de tickets exige auth
  app.addHook("preHandler", app.authenticate as any);

  // GET /tickets
  app.get("/", list);

  // POST /tickets
  app.post("/", create);

  // GET /tickets/:id
  app.get("/:id", getOne);

  // PATCH /tickets/:id
  app.patch("/:id", patch);

  // DELETE /tickets/:id
  app.delete("/:id", removeSoft);

  // mensagens do ticket (vai virar /tickets/:ticketId/mensagens/... lá no register)
  app.register(ticketMessagesRoutes, { prefix: "" });
}
