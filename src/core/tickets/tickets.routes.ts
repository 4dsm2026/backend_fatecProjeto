import type { FastifyInstance } from "fastify";
// src/core/tickets/tickets.routes.ts
import { create, getOne, list, patch, removeSoft } from "./tickets.controller.js";

export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  app.post("/", create);
  app.get("/", list);
  app.get("/:id", getOne);
  app.patch("/:id", patch);
  app.delete("/:id", removeSoft);
}
