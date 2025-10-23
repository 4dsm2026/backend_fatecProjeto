import { FastifyInstance } from "fastify";
import * as ctl from "./usuarioSetor.controller";

export async function usuarioSetorRoutes(app: FastifyInstance) {
  app.post("/usuarios/:usuarioId/setores", ctl.vincular);
  app.get("/usuarios/:usuarioId/setores", ctl.listSetoresDoUsuario);
  app.get("/setores/:setorId/usuarios", ctl.listUsuariosDoSetor);
  app.patch("/usuarios-setores/:usuarioSetorId", ctl.alterarPapel);
  app.delete("/usuarios-setores/:usuarioSetorId", ctl.desvincular);
}