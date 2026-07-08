import { FastifyInstance } from "fastify";
import * as ctl from "./comunicacoes.controller";

export async function comunicacoesRoutes(app: FastifyInstance) {
  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  };

  app.get('/comunicacoes', handlers, ctl.list);
  app.put('/comunicacoes/:chave', handlers, ctl.upsert);
  app.post('/comunicacoes/teste', handlers, ctl.enviarTeste);
}
