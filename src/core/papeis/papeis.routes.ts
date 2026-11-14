import type { FastifyInstance } from "fastify";
import * as ctl from "./papeis.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const TAG = "Admin - Papéis";

const idType = {
  type: "string",
  description: "ID textual do papel, gerado pelo Prisma como CUID. O Zod exige apenas uma string não vazia.",
  example: "cm1234567890abcdef123456",
} as const;

const papelSchema = {
  type: "object",
  required: ["id", "nome", "descricao"],
  properties: {
    id: idType,
    nome: {
      type: "string",
      description: "Nome único do papel no catálogo.",
      example: "Coordenador",
    },
    descricao: {
      type: "string",
      nullable: true,
      description: "Descrição opcional do papel; pode ser null.",
      example: "Coordena as atividades do setor",
    },
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
    nome: {
      type: "string",
      minLength: 2,
      description: "Nome obrigatório na criação e opcional na atualização. Deve conter pelo menos 2 caracteres e ser único no catálogo.",
      example: "Coordenador",
    },
    descricao: {
      type: "string",
      minLength: 1,
      nullable: true,
      description: "Descrição opcional. Aceita null; quando string, deve conter ao menos 1 caractere.",
      example: "Coordena as atividades do setor",
    },
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

const PapelResourceSchema = {
  type: "object",
  required: ["id", "nome", "descricao", "_links"],
  properties: { ...papelSchema.properties, _links: LinksSchema },
} as const;

const RolesCollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: {
      type: "object",
      required: ["roles"],
      properties: { roles: { type: "array", items: PapelResourceSchema } },
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

const validationError = (
  description: string,
  pathExample: string,
  messageExample: string,
) => ({
  ...ProblemSchema,
  description,
  properties: {
    ...ProblemSchema.properties,
    errors: {
      ...ProblemSchema.properties.errors,
      example: [{ field: pathExample, message: messageExample }],
    },
  },
});

const errorResponse = (description: string, example: string) => ({
  ...ProblemSchema,
  description,
  properties: { ...ProblemSchema.properties, title: { type: "string", example } },
});

const RateLimitHeaders = {
  "x-ratelimit-limit": {
    type: "integer",
    description: "Limite de requisições na janela atual (100 por minuto).",
  },
  "x-ratelimit-remaining": {
    type: "integer",
    description: "Requisições restantes na janela atual.",
  },
  "x-ratelimit-reset": {
    type: "integer",
    description: "Segundos até o reinício da janela atual.",
  },
} as const;

const rateLimit429 = (endpointDescription: string) => ({
  ...ProblemSchema,
  description:
    `${endpointDescription} A API aplica um limite global de 100 requisições por minuto ` +
    "por IP; os endereços de loopback 127.0.0.1 e ::1 estão na lista de exceção.",
  headers: {
    ...RateLimitHeaders,
    "retry-after": {
      type: "integer",
      description: "Segundos que o cliente deve aguardar antes de repetir a requisição.",
    },
  },
});

const unauthorized = errorResponse(
  "O token Bearer está ausente, malformado, inválido ou expirado. A verificação interrompe a requisição antes do controller.",
  "Não autorizado",
);
const forbidden = errorResponse(
  "O token foi autenticado, mas o papel do usuário não é ADMINISTRADOR.",
  "Acesso negado",
);
const papelNotFound = errorResponse(
  "O papel solicitado não existe.",
  "Papel não encontrado",
);
const databaseError = (description: string, example: string) => errorResponse(description, example);
const inUseConflict = errorResponse(
  "O papel está associado a um ou mais vínculos de usuários e não pode ser removido.",
  "Papel em uso por vínculos de usuários.",
);

export async function papeisRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  }

  const security = [{ bearerAuth: [] }];

  app.get('/roles', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar papéis",
      description:
        "Lista os papéis do catálogo em uma coleção HAL paginada, ordenada alfabeticamente pelo nome.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 0, default: 0 },
          size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          description: "Coleção HAL paginada de papéis.",
          headers: RateLimitHeaders,
          ...RolesCollectionSchema,
        },
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A listagem foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar o catálogo. Detalhes internos não são expostos.",
          "Erro interno do servidor",
        ),
      },
    },
  }, ctl.list)

  app.post('/roles', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Criar papel",
      description:
        "Adiciona um papel ao catálogo. `nome` é obrigatório, deve conter ao " +
        "menos 2 caracteres e precisa ser único; `descricao` pode ser omitida " +
        "ou enviada como null e, quando texto, deve conter pelo menos 1 " +
        "caractere.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      body: { ...papelBody, required: ["nome"] },
      response: {
        201: {
          description: "Papel criado como recurso HAL.",
          headers: {
            ...RateLimitHeaders,
            Location: { type: "string", example: "/admin/roles/cm1234567890abcdef123456" },
          },
          ...PapelResourceSchema,
        },
        400: validationError(
          "Falha na validação. O problem inclui `errors` com os campos inválidos; " +
          "por exemplo, quando `nome` está ausente ou tem menos de 2 caracteres.",
          "nome",
          "Obrigatório",
        ),
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A criação foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao persistir o papel. Detalhes internos não são expostos; nomes duplicados retornam 409.",
          "Erro interno do servidor",
        ),
      },
    },
  }, ctl.create)

  app.get('/roles/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Buscar papel por ID",
      description:
        "Busca um papel pelo ID textual. O parâmetro precisa ser uma string não " +
        "vazia; a existência do papel é verificada no banco.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      response: {
        200: {
          description: "Papel encontrado como recurso HAL.",
          headers: RateLimitHeaders,
          ...PapelResourceSchema,
        },
        400: validationError(
          "Falha na validação do parâmetro; o problem inclui `errors` com os campos inválidos. " +
          "ocorre, por exemplo, se `id` for uma string vazia.",
          "id",
          "String must contain at least 1 character(s)",
        ),
        401: unauthorized,
        403: forbidden,
        404: papelNotFound,
        429: rateLimit429("A busca foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar o papel. Detalhes internos não são expostos.",
          "Erro interno do servidor",
        ),
      },
    },
  }, ctl.getOne)

  app.patch('/roles/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Atualizar papel",
      description:
        "Atualiza parcialmente o papel identificado por `id`. `nome` e " +
        "`descricao` são opcionais; quando informados, seguem as regras da " +
        "criação. O schema Zod aceita um objeto vazio. O nome atualizado deve " +
        "continuar único no catálogo.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      body: papelBody,
      response: {
        200: {
          description: "Papel atualizado como recurso HAL.",
          headers: RateLimitHeaders,
          ...PapelResourceSchema,
        },
        400: validationError(
          "Falha na validação dos parâmetros ou do corpo; o problem inclui `errors` com os campos inválidos. " +
          "Pode ocorrer se `id` for vazio, `nome` tiver " +
          "menos de 2 caracteres ou `descricao` for uma string vazia.",
          "nome",
          "String must contain at least 2 character(s)",
        ),
        401: unauthorized,
        403: forbidden,
        404: papelNotFound,
        429: rateLimit429("A atualização foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao atualizar o papel. Detalhes internos não são expostos; nomes duplicados retornam 409.",
          "Erro interno do servidor",
        ),
      },
    },
  }, ctl.patch)

  app.delete('/roles/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Excluir papel",
      description:
        "Remove definitivamente o papel identificado por `id`. Antes de excluir, " +
        "o serviço verifica se há vínculos de usuários utilizando o papel; se " +
        "houver, a operação é recusada.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      response: {
        // @fastify/swagger usa type null como marcador e o omite do OpenAPI final.
        204: {
          description: "Papel excluído com sucesso. Conforme o status HTTP 204, a resposta não contém corpo.",
          headers: RateLimitHeaders,
          type: "null",
        },
        400: validationError(
          "Falha na validação do parâmetro; o problem inclui `errors` com os campos inválidos. " +
          "ocorre, por exemplo, se `id` for uma string vazia.",
          "id",
          "String must contain at least 1 character(s)",
        ),
        401: unauthorized,
        403: forbidden,
        404: papelNotFound,
        409: inUseConflict,
        429: rateLimit429("A exclusão foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao verificar vínculos ou excluir o papel. Detalhes internos não são expostos.",
          "Erro interno do servidor",
        ),
      },
    },
  }, ctl.removeHard)
}