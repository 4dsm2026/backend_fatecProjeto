import { FastifyInstance } from "fastify";
import * as ctl from "./papeis.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const TAG = "Admin - Papéis";

const idType = { type: "string", example: "cm1234567890abcdef123456" } as const;

const papelSchema = {
  type: "object",
  properties: {
    id: idType,
    nome: { type: "string", example: "Coordenador" },
    descricao: { type: "string", nullable: true, example: "Coordena as atividades do setor" },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { ...idType, description: "ID do papel" } },
} as const;

const papelBody = {
  type: "object",
  properties: {
    nome: { type: "string", minLength: 2, example: "Coordenador" },
    descricao: { type: "string", minLength: 1, nullable: true, example: "Coordena as atividades do setor" },
  },
} as const;

const validationError = {
  description: "Dados inválidos (falha na validação Zod)",
  type: "object",
  required: ["message", "issues"],
  properties: {
    message: { type: "string", example: "Validação falhou" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", example: "nome" },
          message: { type: "string", example: "String must contain at least 2 character(s)" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

const errorResponse = (description: string) => ({
  description,
  type: "object",
  properties: { error: { type: "string" } },
});

const unauthorized = errorResponse("Token ausente, inválido ou expirado");
const forbidden = errorResponse("Acesso negado; requer perfil ADMINISTRADOR");
const notFound = errorResponse("Papel não encontrado");
const serverError = errorResponse("Erro interno do servidor");
const conflict = errorResponse("Papel em uso por vínculos de usuários; não pode ser removido");

export async function papeisRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  }

  const security = [{ bearerAuth: [] }];

  app.get('/papeis', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar papéis",
      description: "Lista o catálogo de papéis em ordem alfabética. Requer perfil ADMINISTRADOR.",
      security,
      response: {
        200: { description: "Papéis cadastrados", type: "array", items: papelSchema },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  }, ctl.list)

  app.post('/papeis', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Criar papel",
      description: "Adiciona um papel ao catálogo. `nome` deve ter ao menos 2 caracteres; `descricao` é opcional. Requer perfil ADMINISTRADOR.",
      security,
      body: { ...papelBody, required: ["nome"] },
      response: {
        201: { description: "Papel criado", ...papelSchema },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  }, ctl.create)

  app.get('/papeis/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Buscar papel por ID",
      description: "Retorna os dados de um papel do catálogo. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      response: {
        200: { description: "Papel encontrado", ...papelSchema },
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  }, ctl.getOne)

  app.patch('/papeis/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Atualizar papel",
      description: "Atualiza parcialmente um papel do catálogo. `nome` e `descricao` são opcionais; quando informados, devem atender às regras de criação. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      body: papelBody,
      response: {
        200: { description: "Papel atualizado", ...papelSchema },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  }, ctl.patch)

  app.delete('/papeis/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Excluir papel",
      description: "Remove definitivamente um papel. A exclusão é impedida enquanto houver vínculos de usuários usando o papel. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      response: {
        // @fastify/swagger usa type null como marcador e o omite do OpenAPI final.
        204: { description: "Papel excluído; a resposta não contém corpo", type: "null" },
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        500: serverError,
      },
    },
  }, ctl.removeHard)
}