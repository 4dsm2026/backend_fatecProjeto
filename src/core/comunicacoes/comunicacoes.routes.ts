import type { FastifyInstance } from "fastify";
import * as ctl from "./comunicacoes.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const TAG = "Admin - Comunicações";

const ComunicacaoTemplateSchema = {
  type: "object",
  title: "ComunicacaoTemplate",
  required: ["id", "chave", "nome", "habilitado", "assunto", "corpo", "criadoEm", "atualizadoEm"],
  properties: {
    id: { type: "string" },
    chave: { type: "string", minLength: 1, maxLength: 64 },
    nome: { type: "string", maxLength: 160 },
    descricao: { type: "string", nullable: true, maxLength: 500 },
    habilitado: { type: "boolean", default: true },
    assunto: { type: "string", maxLength: 500 },
    corpo: { type: "string" },
    variaveis: { type: "array", nullable: true, items: { type: "string" } },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
  },
} as const;

const LinkSchema = {
  type: "object",
  required: ["href", "method"],
  properties: {
    href: { type: "string" },
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
  },
} as const;

const LinksSchema = {
  type: "object",
  additionalProperties: { oneOf: [LinkSchema, { type: "array", items: LinkSchema }] },
} as const;

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
        properties: { field: { type: "string" }, message: { type: "string" } },
      },
    },
  },
} as const;

const ComunicacaoResourceSchema = {
  ...ComunicacaoTemplateSchema,
  required: [...ComunicacaoTemplateSchema.required, "_links"],
  properties: { ...ComunicacaoTemplateSchema.properties, _links: LinksSchema },
} as const;

const ComunicacoesCollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: {
      type: "object",
      required: ["communication-templates"],
      properties: {
        "communication-templates": { type: "array", items: ComunicacaoResourceSchema },
      },
    },
    page: {
      type: "object",
      required: ["size", "number", "totalElements", "totalPages"],
      properties: {
        size: { type: "integer" },
        number: { type: "integer" },
        totalElements: { type: "integer" },
        totalPages: { type: "integer" },
      },
    },
    _links: LinksSchema,
  },
} as const;

const ProblemResponses = {
  400: { description: "Dados inválidos.", ...ProblemSchema },
  401: { description: "Token ausente, inválido ou expirado.", ...ProblemSchema },
  403: { description: "Apenas ADMINISTRADOR pode gerenciar templates.", ...ProblemSchema },
  404: { description: "Template de comunicação não encontrado.", ...ProblemSchema },
  409: { description: "Conflito ao persistir o template.", ...ProblemSchema },
  429: { description: "Limite de requisições excedido.", ...ProblemSchema },
  500: { description: "Erro inesperado.", ...ProblemSchema },
} as const;

export async function comunicacoesRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [app.authenticate, app.authorize(["ADMINISTRADOR"])],
  };
  const security = [{ bearerAuth: [] }];

  app.get("/communication-templates", {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar templates de comunicação",
      description: "Retorna uma coleção HAL paginada de templates persistidos, ordenados por `chave`.",
      security,
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 0, default: 0 },
          size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { description: "Coleção HAL paginada.", ...ComunicacoesCollectionSchema },
        ...ProblemResponses,
      },
    },
  }, ctl.list);

  app.get("/communication-templates/:chave", {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Buscar template de comunicação pela chave",
      security,
      params: {
        type: "object",
        required: ["chave"],
        properties: { chave: { type: "string", minLength: 1, maxLength: 64 } },
      },
      response: {
        200: { description: "Recurso HAL de template.", ...ComunicacaoResourceSchema },
        ...ProblemResponses,
      },
    },
  }, ctl.getOne);

  app.put("/communication-templates/:chave", {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Criar ou atualizar template de comunicação pela chave",
      description: "Criação retorna 201 com Location; atualização retorna 200.",
      security,
      params: {
        type: "object",
        required: ["chave"],
        properties: { chave: { type: "string", minLength: 1, maxLength: 64 } },
      },
      body: {
        type: "object",
        required: ["nome", "assunto", "corpo"],
        properties: {
          nome: { type: "string", minLength: 1, maxLength: 160 },
          descricao: { type: "string", nullable: true, maxLength: 500 },
          habilitado: { type: "boolean", default: true },
          assunto: { type: "string", minLength: 1, maxLength: 500 },
          corpo: { type: "string", minLength: 1 },
          variaveis: { type: "array", items: { type: "string" } },
        },
      },
      response: {
        201: {
          description: "Template criado como recurso HAL.",
          headers: { Location: { type: "string", example: "/admin/communication-templates/boas-vindas" } },
          ...ComunicacaoResourceSchema,
        },
        200: { description: "Template atualizado como recurso HAL.", ...ComunicacaoResourceSchema },
        ...ProblemResponses,
      },
    },
  }, ctl.upsert);

  app.post('/communication-tests', {
    ...handlers,
    schema: {
      tags: ['Admin - Comunicações'],
      summary: 'Enviar um teste de comunicação por e-mail',
      description:
        "Envia imediatamente um e-mail de teste para o destinatário `to`, " +
        "usando o `assunto`/`corpo` informados no corpo da requisição — não " +
        "precisa haver um template salvo previamente; o conteúdo é enviado " +
        "'na hora', renderizado com uma amostra de dados (`renderComAmostra`).\n\n" +
        "**Restrito a administradores.**",
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['to', 'assunto', 'corpo'],
        properties: {
          to: { type: 'string', format: 'email', description: 'E-mail de destino do teste.', example: 'teste@exemplo.com' },
          assunto: { type: 'string', minLength: 1, maxLength: 500 },
          corpo: { type: 'string', minLength: 1 },
        }
      },
      response: {
        200: {
          description: 'E-mail de teste enviado com sucesso.',
          type: 'object',
          properties: { message: { type: 'string', example: 'E-mail de teste enviado para teste@exemplo.com' } }
        },
        ...ProblemResponses,
      }
    }
  }, ctl.enviarTeste);
}