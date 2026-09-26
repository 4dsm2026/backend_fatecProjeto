import { FastifyInstance } from "fastify";
import * as ctl from "./usuarioSetor.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

export async function usuarioSetorRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  const handlers = {
    preHandler: [
      app.authenticate,
      app.authorize(['ADMINISTRADOR', 'TECNICO']),
    ],
  }

  app.post('/usuarios/:usuarioId/setores', handlers, ctl.vincular)
  app.get('/usuarios/:usuarioId/setores', handlers, ctl.listSetoresDoUsuario)
  app.get('/setores/:setorId/usuarios', handlers, ctl.listUsuariosDoSetor)
  app.patch('/usuarios-setores/:usuarioSetorId', handlers, ctl.alterarPapel)
  app.delete('/usuarios-setores/:usuarioSetorId', handlers, ctl.desvincular)
}