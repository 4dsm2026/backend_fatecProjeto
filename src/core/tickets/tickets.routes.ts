import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft, stats } from "./tickets.controller.js";
import { ticketMessagesRoutes } from "../ticket-messages/messages.routes.js";

export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  // GET /tickets/stats  — deve vir ANTES de /:id para não ser interceptado como param
  // Estatísticas globais são de equipe; aluno (USUARIO) não acessa.
  app.get("/stats", { preHandler: (app as any).authorize(["ADMINISTRADOR", "BACKOFFICE", "TECNICO"]) }, stats);

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

  app.register(ticketMessagesRoutes, { prefix: "" });
}
