import type { FastifyInstance } from "fastify";
import {
  list,
  upload,
  download,
  generateDownloadTokenRoute,
} from "./anexos.controller";

export async function anexoRoutes(app: FastifyInstance) {
  // 🔐 aplica autenticação para todas as rotas de anexo
  app.addHook("preHandler", app.authenticate as any);

  // Listar anexos de um chamado específico
  app.get("/tickets/:id/anexos", list);

  // Fazer upload de um anexo para um chamado específico
  app.post("/tickets/:id/anexos", upload);

  // Baixar um anexo específico pelo ID do anexo
  app.get("/anexos/:anexoId/download", download);

  // Gerar token de download temporário
  app.post("/anexos/:anexoId/download-token", generateDownloadTokenRoute);
}
