import { FastifyInstance } from "fastify";
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

const validationError = (
  description: string,
  pathExample: string,
  messageExample: string,
  codeExample = "too_small",
) => ({
  description,
  type: "object",
  required: ["message", "issues"],
  properties: {
    message: { type: "string", example: "Validação falhou" },
    issues: {
      type: "array",
      description: "Falhas encontradas pelo Zod. `path` identifica o campo, `message` explica a regra e `code` informa o código da validação.",
      items: {
        type: "object",
        required: ["path", "message", "code"],
        properties: {
          path: { type: "string", example: pathExample },
          message: { type: "string", example: messageExample },
          code: { type: "string", example: codeExample },
        },
      },
    },
  },
});

const errorResponse = (description: string, example: string) => ({
  description,
  type: "object",
  required: ["error"],
  properties: { error: { type: "string", example } },
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
  type: "object",
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer", example: 429 },
    error: { type: "string", example: "Too Many Requests" },
    message: {
      type: "string",
      description: "Mensagem informa quantos segundos faltam para o limite ser liberado.",
      example: "Limite de requisições atingido. Tente novamente em 42s.",
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
  "O papel solicitado não existe. O corpo identifica o recurso não encontrado.",
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

  app.get('/papeis', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar papéis",
      description:
        "Lista todos os papéis cadastrados no catálogo, ordenados alfabeticamente " +
        "pelo nome. A resposta é um array; este endpoint não recebe parâmetros " +
        "de paginação ou filtros.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      response: {
        200: {
          description: "Lista retornada com sucesso; pode ser um array vazio se não houver papéis cadastrados.",
          headers: RateLimitHeaders,
          type: "array",
          items: papelSchema,
        },
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A listagem foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar o catálogo. O controller retorna `{ error }` " +
          "com a mensagem da exceção do Prisma ou do banco de dados.",
          "Mensagem da exceção ocorrida ao consultar o catálogo",
        ),
      },
    },
  }, ctl.list)

  app.post('/papeis', {
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
          description: "Papel criado com sucesso. Retorna o registro persistido, incluindo o ID gerado pelo Prisma.",
          headers: RateLimitHeaders,
          ...papelSchema,
        },
        400: validationError(
          "Falha na validação Zod do corpo. O formato é `{ message, issues }`; " +
          "por exemplo, quando `nome` está ausente ou tem menos de 2 caracteres.",
          "nome",
          "Required",
          "invalid_type",
        ),
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A criação foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao persistir o papel. Isso inclui falhas do banco e " +
          "violação da unicidade de `nome`; o controller retorna `{ error }` " +
          "com a mensagem da exceção, sem convertê-la em 409.",
          "Mensagem da exceção ocorrida ao criar o papel",
        ),
      },
    },
  }, ctl.create)

  app.get('/papeis/:id', {
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
          description: "Papel encontrado. Retorna `id`, `nome` e `descricao`.",
          headers: RateLimitHeaders,
          ...papelSchema,
        },
        400: validationError(
          "Falha na validação Zod do parâmetro. O formato é `{ message, issues }`; " +
          "ocorre, por exemplo, se `id` for uma string vazia.",
          "id",
          "String must contain at least 1 character(s)",
        ),
        401: unauthorized,
        403: forbidden,
        404: papelNotFound,
        429: rateLimit429("A busca foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar o papel. O controller retorna `{ error }` " +
          "com a mensagem da exceção do Prisma ou do banco de dados.",
          "Mensagem da exceção ocorrida ao buscar o papel",
        ),
      },
    },
  }, ctl.getOne)

  app.patch('/papeis/:id', {
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
          description: "Papel atualizado com sucesso. Retorna o registro persistido com seus valores atuais.",
          headers: RateLimitHeaders,
          ...papelSchema,
        },
        400: validationError(
          "Falha na validação Zod dos parâmetros ou do corpo. O formato é " +
          "`{ message, issues }`; pode ocorrer se `id` for vazio, `nome` tiver " +
          "menos de 2 caracteres ou `descricao` for uma string vazia.",
          "nome",
          "String must contain at least 2 character(s)",
        ),
        401: unauthorized,
        403: forbidden,
        404: papelNotFound,
        429: rateLimit429("A atualização foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao atualizar o papel. Isso inclui falhas do banco e " +
          "violação da unicidade de `nome`; o controller converte somente " +
          "`P2025` em 404 e retorna os demais erros em `{ error }`.",
          "Mensagem da exceção ocorrida ao atualizar o papel",
        ),
      },
    },
  }, ctl.patch)

  app.delete('/papeis/:id', {
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
          "Falha na validação Zod do parâmetro. O formato é `{ message, issues }`; " +
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
          "Falha inesperada ao verificar vínculos ou excluir o papel. O controller " +
          "converte `P2025` em 404 e os demais erros em `{ error }`.",
          "Mensagem da exceção ocorrida ao excluir o papel",
        ),
      },
    },
  }, ctl.removeHard)
}