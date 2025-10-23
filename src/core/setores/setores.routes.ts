import { FastifyInstance } from "fastify";
import * as ctl from "./setores.controller";

export async function setoresRoutes(app: FastifyInstance) {
  app.post("/setores", ctl.create);
  app.get("/setores/:id", ctl.getOne);
  app.get("/setores", ctl.list);
  app.patch("/setores/:id", ctl.patch);
  app.delete("/setores/:id", ctl.removeHard);
}