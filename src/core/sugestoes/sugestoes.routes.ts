import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema, STAFF_ROLES } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { create, getOne, list, responder } from "./sugestoes.controller";

const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    errors: { type: "array", items: { type: "object" } },
  },
} as const;

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const SuggestionSchema = {
  type: "object",
  required: ["id", "usuarioId", "emailContato", "conteudo", "status", "_links"],
  properties: {
    id: { type: "string" },
    usuarioId: { type: "string" },
    emailContato: { type: "string", format: "email" },
    conteudo: { type: "string" },
    documento: { type: "object", nullable: true, additionalProperties: true },
    status: { type: "string", enum: ["NAO_RESPONDIDO", "RESPONDIDO"] },
    resposta: { type: "string", nullable: true },
    respostaDocumento: { type: "object", nullable: true, additionalProperties: true },
    respondidoPorId: { type: "string", nullable: true },
    respondidoEm: { type: "string", format: "date-time", nullable: true },
    criadoEm: { type: "string", format: "date-time" },
    usuario: {
      type: "object",
      properties: {
        id: { type: "string" },
        nome: { type: "string" },
        ra: { type: "string", nullable: true },
      },
    },
    respondidoPor: {
      type: "object",
      nullable: true,
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
      required: ["suggestions"],
      properties: {
        suggestions: { type: "array", items: SuggestionSchema },
      },
    },
    page: PageInfoSchema,
    _links: HalLinksSchema,
  },
} as const;

const security = [{ bearerAuth: [] }];
const commonProblems = {
  400: problemResponse("Dados inválidos."),
  401: problemResponse("Autenticação obrigatória."),
  403: problemResponse("Papel sem permissão para a ação."),
  404: problemResponse("Sugestão não encontrada."),
  409: problemResponse("Sugestão já respondida."),
  429: problemResponse("Limite de requisições excedido."),
  500: problemResponse("Erro inesperado."),
} as const;

export async function sugestoesRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/",
    {
      schema: {
        tags: ["Suggestions"],
        summary: "Criar sugestão",
        security,
        body: {
          type: "object",
          required: ["emailContato", "conteudo"],
          properties: {
            emailContato: { type: "string", format: "email" },
            conteudo: { type: "string", minLength: 3, maxLength: 1000 },
            documento: { type: "object", additionalProperties: true },
          },
        },
        response: {
          201: {
            description: "Sugestão criada.",
            headers: { Location: { type: "string" } },
            ...SuggestionSchema,
          },
          ...commonProblems,
        },
      },
    },
    create,
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["Suggestions"],
        summary: "Listar sugestões visíveis ao usuário",
        security,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            status: { type: "string", enum: ["NAO_RESPONDIDO", "RESPONDIDO"] },
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

  app.get(
    "/:id",
    {
      schema: {
        tags: ["Suggestions"],
        summary: "Consultar sugestão",
        security,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        response: {
          200: SuggestionSchema,
          ...commonProblems,
        },
      },
    },
    getOne,
  );

  app.patch(
    "/:id",
    {
      preHandler: app.authorize([...STAFF_ROLES]),
      schema: {
        tags: ["Suggestions"],
        summary: "Responder sugestão",
        description: "A resposta é obrigatória e imutável depois de registrada.",
        security,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["resposta"],
          properties: {
            resposta: { type: "string", minLength: 1, maxLength: 1000 },
            respostaDocumento: { type: "object", additionalProperties: true },
          },
        },
        response: {
          200: SuggestionSchema,
          ...commonProblems,
        },
      },
    },
    responder,
  );
}
