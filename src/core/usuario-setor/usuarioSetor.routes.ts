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
  app.get('/setores/:setorId/usuarios', {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR', 'TECNICO'])],
    schema: {
      tags: ["Admin - Setores"],
      summary: "Listar usuários de um setor",
      description: "Lista os vínculos de usuários do setor, incluindo dados resumidos do usuário e o papel no setor. `page` começa em 1, `perPage` aceita de 1 a 100 e `search` filtra por nome, e-mail ou RA. Requer perfil ADMINISTRADOR ou TECNICO.",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["setorId"],
        properties: {
          setorId: { type: "string", description: "ID do setor", example: "cm1234567890abcdef123456" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1, description: "Página atual" },
          perPage: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Quantidade de itens por página" },
          search: { type: "string", minLength: 1, description: "Busca por nome, e-mail pessoal, e-mail educacional ou RA" },
        },
      },
      response: {
        200: {
          description: "Vínculos encontrados",
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", example: "cm1234567890abcdef123456" },
                  usuarioId: { type: "string", example: "cm1234567890abcdef123457" },
                  setorId: { type: "string", example: "cm1234567890abcdef123458" },
                  papelId: { type: "string", nullable: true, example: "cm1234567890abcdef123459" },
                  criadoEm: { type: "string", format: "date-time" },
                  usuario: {
                    type: "object",
                    properties: {
                      id: { type: "string", example: "cm1234567890abcdef123457" },
                      nome: { type: "string", example: "João Silva" },
                      emailPessoal: { type: "string", format: "email" },
                      emailEducacional: { type: "string", format: "email", nullable: true },
                      ra: { type: "string", nullable: true },
                      papel: { type: "string", enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"] },
                      ativo: { type: "boolean" },
                    },
                  },
                  papel: {
                    type: "object",
                    nullable: true,
                    properties: {
                      id: { type: "string", example: "cm1234567890abcdef123459" },
                      nome: { type: "string", example: "Coordenador" },
                      descricao: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            total: { type: "integer", example: 25 },
            page: { type: "integer", example: 1 },
            perPage: { type: "integer", example: 20 },
          },
        },
        400: {
          description: "Parâmetros inválidos (falha na validação Zod)",
          type: "object",
          required: ["message", "issues"],
          properties: {
            message: { type: "string", example: "Validação falhou" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", example: "querystring.perPage" },
                  message: { type: "string", example: "Number must be less than or equal to 100" },
                  code: { type: "string", example: "too_big" },
                },
              },
            },
          },
        },
        401: { description: "Token ausente, inválido ou expirado", type: "object", properties: { error: { type: "string", example: "Não autorizado" } } },
        403: { description: "Acesso negado; requer perfil ADMINISTRADOR ou TECNICO", type: "object", properties: { error: { type: "string", example: "Acesso negado" } } },
        500: { description: "Erro interno do servidor", type: "object", properties: { error: { type: "string" } } },
      },
    },
  }, ctl.listUsuariosDoSetor)
  app.patch('/usuarios-setores/:usuarioSetorId', handlers, ctl.alterarPapel)
  app.delete('/usuarios-setores/:usuarioSetorId', handlers, ctl.desvincular)
}