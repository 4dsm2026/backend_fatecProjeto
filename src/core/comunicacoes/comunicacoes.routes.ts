import { FastifyInstance } from "fastify";
import * as ctl from "./comunicacoes.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

export async function comunicacoesRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  };

  app.get('/comunicacoes', handlers, ctl.list);
  app.put('/comunicacoes/:chave', handlers, ctl.upsert);
  app.post('/comunicacoes/teste', handlers, ctl.enviarTeste);
}
