import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft } from "./tickets.controller.js";
import { ticketMessagesRoutes } from "../ticket-messages/messages.routes.js";

export async function ticketsRoutes(app: FastifyInstance) {
  // autenticação para tudo que é tickets
  app.addHook("preHandler", app.authenticate as any);

  // LISTAR TICKETS
  // GET /tickets
  app.get("/tickets", list);

  // CRIAR TICKET
  // POST /tickets
  app.post("/tickets", create);

  // OBTER UM TICKET
  // GET /tickets/:id
  app.get("/tickets/:id", getOne);

  // ATUALIZAR TICKET
  // PATCH /tickets/:id
  app.patch("/tickets/:id", patch);

  // REMOÇÃO SOFT
  // DELETE /tickets/:id
  app.delete("/tickets/:id", removeSoft);

  // Rotas de mensagens do ticket.
  // Ex: /tickets/:ticketId/mensagens ...
  app.register(ticketMessagesRoutes);
}
