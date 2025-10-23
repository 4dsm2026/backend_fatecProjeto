import { FastifyInstance } from "fastify";
import * as ctl from "./papeis.controller";

export async function papeisRoutes(app: FastifyInstance) {
  app.get("/papeis", ctl.list);
  app.post("/papeis", ctl.create);
  app.get("/papeis/:id", ctl.getOne);
  app.patch("/papeis/:id", ctl.patch);
  app.delete("/papeis/:id", ctl.removeHard);
}