import { FastifyInstance } from "fastify";
import * as ctl from "./setores.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const TAG = "Admin - Setores";

/* ---------- Schemas reutilizáveis (SÓ PARA DOCUMENTAÇÃO) ---------- */

const idType = { type: "string", example: "cm1234567890abcdef123456" } as const;

const setorSchema = {
  type: "object",
  properties: {
    id: idType,
    organizacaoId: { type: "string", nullable: true, example: "cm1234567890abcdef123457" },
    nome: { type: "string", example: "Suporte Técnico" },
    descricao: { type: "string", nullable: true, example: "Atende chamados de TI" },
  },
} as const;

const setorComContagensSchema = {
  ...setorSchema,
  properties: {
    ...setorSchema.properties,
    _count: {
      type: "object",
      properties: {
        usuarioSetores: { type: "integer", example: 8 },
        chamados: { type: "integer", example: 24 },
      },
    },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { ...idType, description: "ID do setor" } },
} as const;

const setorBody = {
  type: "object",
  properties: {
    nome: { type: "string", minLength: 2, example: "Suporte Técnico" },
    descricao: { type: "string", minLength: 1, nullable: true, example: "Atende chamados de TI" },
    organizacaoId: { type: "string", minLength: 1, nullable: true, example: "cm1234567890abcdef123457" },
  },
} as const;

const errorSchema = (description: string) => ({
  description,
  type: "object",
  properties: { error: { type: "string" } },
});

const validationError = errorSchema("Dados inválidos (falha na validação Zod)");
const unauthorized = errorSchema("Não autenticado (token ausente ou inválido)");
const forbidden = errorSchema("Sem permissão (requer perfil ADMINISTRADOR)");
const notFound = errorSchema("Setor não encontrado");
const serverError = errorSchema("Erro interno do servidor");

export async function setoresRoutes(app: FastifyInstance) {
  // Deve vir ANTES das rotas: o schema vira só doc, a validação segue no Zod.
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  }

  const security = [{ bearerAuth: [] }];

  app.post('/setores', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Criar setor",
      description: "Cria um setor. O nome deve ter ao menos 2 caracteres; descrição e organização são opcionais. Requer perfil ADMINISTRADOR.",
      security,
      body: { ...setorBody, required: ["nome"] },
      response: {
        201: { description: "Setor criado", ...setorSchema },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  }, ctl.create)

  app.get('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Buscar setor por ID",
      description: "Retorna os dados do setor e as quantidades de vínculos de usuários e chamados. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      response: {
        200: { description: "Setor encontrado", ...setorComContagensSchema },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  }, ctl.getOne)

  app.get('/setores', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar setores",
      description: "Lista setores por nome, com paginação. `page` começa em 1, `perPage` aceita de 1 a 100, `search` filtra pelo nome e `organizacaoId` filtra pela organização. Requer perfil ADMINISTRADOR.",
      security,
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1, description: "Página atual" },
          perPage: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Quantidade de itens por página" },
          search: { type: "string", minLength: 1, description: "Busca por nome do setor" },
          organizacaoId: { type: "string", minLength: 1, description: "Filtra setores da organização informada" },
        },
      },
      response: {
        200: {
          description: "Página de setores",
          type: "object",
          properties: {
            data: { type: "array", items: setorSchema },
            total: { type: "integer", example: 25 },
            page: { type: "integer", example: 1 },
            perPage: { type: "integer", example: 20 },
          },
        },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  }, ctl.list)

  app.patch('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Atualizar setor",
      description: "Atualiza parcialmente os dados do setor; `nome`, `descricao` e `organizacaoId` são opcionais. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      body: setorBody,
      response: {
        200: { description: "Setor atualizado", ...setorSchema },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  }, ctl.patch)

  app.delete('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Excluir setor",
      description: "Exclui definitivamente o setor. Os vínculos de usuários relacionados são removidos em cascata. Requer perfil ADMINISTRADOR.",
      security,
      params: idParams,
      response: {
        // @fastify/swagger usa type null como marcador e o omite do OpenAPI final.
        204: { description: "Setor excluído; a resposta não contém corpo", type: "null" },
        400: validationError,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        500: serverError,
      },
    },
  }, ctl.removeHard)
}
