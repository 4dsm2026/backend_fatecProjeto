import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { download, getOne, list, upload } from "./anexos.controller";

const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "message"],
        properties: {
          field: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
} as const;

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const AttachmentSchema = {
  type: "object",
  required: ["id", "nomeArquivo", "mimeType", "tamanhoBytes", "enviadoEm", "_links"],
  properties: {
    id: { type: "string" },
    nomeArquivo: { type: "string" },
    mimeType: { type: "string" },
    tamanhoBytes: { type: "integer" },
    enviadoEm: { type: "string", format: "date-time" },
    enviadoPor: {
      type: "object",
      properties: {
        id: { type: "string" },
        nome: { type: "string" },
      },
    },
    _links: HalLinksSchema,
  },
} as const;

const CollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: {
      type: "object",
      required: ["attachments"],
      properties: {
        attachments: { type: "array", items: AttachmentSchema },
      },
    },
    page: PageInfoSchema,
    _links: HalLinksSchema,
  },
} as const;

const commonProblems = {
  400: problemResponse("Parâmetros inválidos."),
  401: problemResponse("Autenticação obrigatória."),
  403: problemResponse("Sem permissão para acessar o anexo."),
  404: problemResponse("Chamado, anexo ou arquivo não encontrado."),
  409: problemResponse("O chamado não aceita novos anexos."),
  429: problemResponse("Limite de requisições excedido."),
  500: problemResponse("Erro inesperado."),
} as const;

const ticketParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

const attachmentParams = {
  type: "object",
  required: ["anexoId"],
  properties: { anexoId: { type: "string", minLength: 1 } },
} as const;

export async function anexoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  useDocsOnlySchemas(app);

  app.get(
    "/tickets/:id/attachments",
    {
      schema: {
        tags: ["Attachments"],
        summary: "Listar anexos de um chamado",
        security: [{ bearerAuth: [] }],
        params: ticketParams,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: CollectionSchema,
          ...commonProblems,
        },
      },
    },
    list,
  );

  app.post(
    "/tickets/:id/attachments",
    {
      schema: {
        tags: ["Attachments"],
        summary: "Enviar anexo para um chamado",
        description: "Aceita multipart/form-data, arquivo de até 10 MB e os tipos MIME permitidos.",
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        params: ticketParams,
        response: {
          201: {
            description: "Anexo criado.",
            headers: { Location: { type: "string" } },
            ...AttachmentSchema,
          },
          400: problemResponse("Requisição inválida."),
          401: commonProblems[401],
          404: commonProblems[404],
          409: commonProblems[409],
          413: problemResponse("Arquivo maior que 10 MB."),
          415: problemResponse("Tipo MIME não permitido."),
          429: commonProblems[429],
          500: commonProblems[500],
        },
      },
    },
    upload,
  );

  app.get(
    "/attachments/:anexoId",
    {
      schema: {
        tags: ["Attachments"],
        summary: "Consultar metadados de um anexo",
        security: [{ bearerAuth: [] }],
        params: attachmentParams,
        response: {
          200: AttachmentSchema,
          ...commonProblems,
        },
      },
    },
    getOne,
  );

  app.get(
    "/attachments/:anexoId/content",
    {
      schema: {
        tags: ["Attachments"],
        summary: "Baixar conteúdo de um anexo",
        security: [{ bearerAuth: [] }],
        params: attachmentParams,
        response: {
          200: {
            description: "Conteúdo binário do anexo.",
            type: "string",
            format: "binary",
          },
          ...commonProblems,
        },
      },
    },
    download,
  );
}
