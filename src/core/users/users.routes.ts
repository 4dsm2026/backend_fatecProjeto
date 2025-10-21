import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft } from "./users.controller";

export async function usersRoutes(app: FastifyInstance) {
  
  app.addHook("preHandler", app.authenticate as any);

  
  app.post("/", create);
  app.get("/", list);
  app.get("/:id", getOne);
  app.patch("/:id", patch);
  app.delete("/:id", removeSoft);
}
