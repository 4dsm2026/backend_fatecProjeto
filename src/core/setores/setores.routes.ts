import { FastifyInstance } from "fastify";
import * as ctl from "./setores.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const TAG = "Admin - Setores";

/* ---------- Schemas reutilizáveis (SÓ PARA DOCUMENTAÇÃO) ---------- */

const idType = {
  type: "string",
  description: "ID textual do setor (gerado pelo Prisma como CUID). O Zod exige apenas uma string não vazia.",
  example: "cm1234567890abcdef123456",
} as const;

const setorSchema = {
  type: "object",
  required: ["id", "organizacaoId", "nome", "descricao"],
  properties: {
    id: idType,
    organizacaoId: {
      type: "string",
      nullable: true,
      description: "ID da organização associada; null quando o setor não pertence a uma organização.",
      example: "cm1234567890abcdef123457",
    },
    nome: {
      type: "string",
      description: "Nome do setor.",
      example: "Suporte Técnico",
    },
    descricao: {
      type: "string",
      nullable: true,
      description: "Descrição do setor; pode ser null.",
      example: "Atende chamados de TI",
    },
  },
} as const;

const setorComContagensSchema = {
  ...setorSchema,
  properties: {
    ...setorSchema.properties,
    _count: {
      type: "object",
      description: "Contagens de vínculos e chamados associados, incluídas somente na busca por ID.",
      required: ["usuarioSetores", "chamados"],
      properties: {
        usuarioSetores: {
          type: "integer",
          description: "Quantidade de vínculos de usuários com o setor.",
          example: 8,
        },
        chamados: {
          type: "integer",
          description: "Quantidade de chamados associados ao setor.",
          example: 24,
        },
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
    nome: {
      type: "string",
      minLength: 2,
      description: "Nome obrigatório na criação e opcional na atualização. Deve conter ao menos 2 caracteres.",
      example: "Suporte Técnico",
    },
    descricao: {
      type: "string",
      minLength: 1,
      nullable: true,
      description: "Descrição opcional. Aceita null; quando string, deve conter ao menos 1 caractere.",
      example: "Atende chamados de TI",
    },
    organizacaoId: {
      type: "string",
      minLength: 1,
      nullable: true,
      description: "ID da organização opcional. Aceita null; quando string, não pode ser vazia.",
      example: "cm1234567890abcdef123457",
    },
  },
} as const;

const errorResponse = (description: string, example: string) => ({
  description,
  type: "object",
  required: ["error"],
  properties: { error: { type: "string", example } },
});

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
      description: "Detalhes das falhas encontradas pelo Zod. `path` contém o caminho do campo e `code` o código da validação.",
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
const sectorNotFound = errorResponse(
  "O setor solicitado não existe. O corpo identifica o recurso não encontrado.",
  "Setor não encontrado",
);
const databaseError = (description: string) => errorResponse(
  description,
  "Mensagem da exceção ocorrida ao acessar o banco de dados",
);

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
      description:
        "Cria um setor e o associa opcionalmente a uma organização. `nome` é " +
        "obrigatório e deve ter pelo menos 2 caracteres; `descricao` e " +
        "`organizacaoId` podem ser omitidos ou enviados como null. Quando " +
        "enviados como texto, esses campos não podem ser vazios.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`. O limite global " +
        "de requisições também se aplica, exceto para os endereços de loopback " +
        "permitidos pelo servidor.",
      security,
      body: { ...setorBody, required: ["nome"] },
      response: {
        201: {
          description:
            "Setor criado com sucesso. Retorna o registro persistido, incluindo " +
            "o ID gerado pelo Prisma e os campos opcionais como null quando " +
            "não foram informados.",
          headers: RateLimitHeaders,
          ...setorSchema,
        },
        400: validationError(
          "Falha na validação Zod do corpo. O formato é `{ message, issues }`; " +
          "por exemplo, `nome` ausente ou com menos de 2 caracteres. Cada " +
          "issue informa o campo (`path`), a regra (`message`) e o código.",
          "nome",
          "Required",
          "invalid_type",
        ),
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A criação foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao persistir o setor. O controller retorna `{ error }` " +
          "com a mensagem da exceção; falhas do Prisma ou da conexão com o banco " +
          "são exemplos possíveis.",
        ),
      },
    },
  }, ctl.create)

  app.get('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Buscar setor por ID",
      description:
        "Busca um setor pelo ID textual e inclui `_count` com as quantidades " +
        "de vínculos de usuários e chamados. O validador exige somente que " +
        "`id` não seja vazio; a existência do registro é verificada no banco.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      response: {
        200: {
          description:
            "Setor encontrado. A resposta contém os campos do registro e " +
            "`_count.usuarioSetores` e `_count.chamados`.",
          headers: RateLimitHeaders,
          ...setorComContagensSchema,
        },
        400: validationError(
          "Falha na validação Zod dos parâmetros. O formato é `{ message, issues }`; " +
          "ocorre, por exemplo, quando `id` é uma string vazia.",
          "id",
          "String must contain at least 1 character(s)",
          "too_small",
        ),
        401: unauthorized,
        403: forbidden,
        404: sectorNotFound,
        429: rateLimit429("A busca foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar o setor. O controller retorna `{ error }` " +
          "com a mensagem da exceção do Prisma ou do banco de dados.",
        ),
      },
    },
  }, ctl.getOne)

  app.get('/setores', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Listar setores",
      description:
        "Lista os setores em ordem alfabética pelo nome, com paginação. `page` " +
        "começa em 1 e assume 1 quando omitido; `perPage` aceita de 1 a 100 e " +
        "assume 20 quando omitido. `search` procura parcialmente no nome, sem " +
        "diferenciar maiúsculas de minúsculas; `organizacaoId` restringe a busca " +
        "a uma organização. A resposta contém `data`, `total`, `page` e " +
        "`perPage`.\n\nRequer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      querystring: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            minimum: 1,
            default: 1,
            description: "Página solicitada. Deve ser um inteiro maior ou igual a 1.",
          },
          perPage: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            description: "Quantidade por página. Deve ser um inteiro entre 1 e 100.",
          },
          search: {
            type: "string",
            minLength: 1,
            description: "Trecho não vazio usado para buscar no nome do setor, sem distinção de caixa.",
          },
          organizacaoId: {
            type: "string",
            minLength: 1,
            description: "ID não vazio da organização usada como filtro.",
          },
        },
      },
      response: {
        200: {
          description:
            "Página de resultados. `data` contém os setores ordenados pelo nome; " +
            "`total` é o total de registros que correspondem aos filtros, antes " +
            "da paginação. Os valores efetivos de `page` e `perPage` são devolvidos.",
          headers: RateLimitHeaders,
          type: "object",
          required: ["data", "total", "page", "perPage"],
          properties: {
            data: {
              type: "array",
              description: "Setores da página atual.",
              items: setorSchema,
            },
            total: {
              type: "integer",
              description: "Quantidade total de setores após aplicar os filtros, sem limitar à página.",
              example: 25,
            },
            page: { type: "integer", description: "Número da página devolvida.", example: 1 },
            perPage: { type: "integer", description: "Limite de itens por página usado na consulta.", example: 20 },
          },
        },
        400: validationError(
          "Falha na validação Zod da query. O formato é `{ message, issues }`; " +
          "pode ocorrer se `page` for menor que 1, `perPage` estiver fora de " +
          "1–100, ou `search`/`organizacaoId` forem strings vazias.",
          "perPage",
          "Number must be less than or equal to 100",
          "too_big",
        ),
        401: unauthorized,
        403: forbidden,
        429: rateLimit429("A listagem foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao consultar ou contar os setores. O controller retorna " +
          "`{ error }` com a mensagem da exceção do Prisma ou do banco de dados.",
        ),
      },
    },
  }, ctl.list)

  app.patch('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Atualizar setor",
      description:
        "Atualiza parcialmente o setor identificado por `id`. Todos os campos " +
        "do corpo são opcionais; quando presentes, seguem as mesmas regras da " +
        "criação. A validação permite um objeto vazio. Se o ID não existir, " +
        "nenhum setor é alterado.\n\nRequer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      body: setorBody,
      response: {
        200: {
          description: "Setor atualizado. Retorna o registro persistido com os valores atuais de todos os campos.",
          headers: RateLimitHeaders,
          ...setorSchema,
        },
        400: validationError(
          "Falha na validação Zod dos parâmetros ou do corpo. O formato é " +
          "`{ message, issues }`; exemplos incluem `id` vazio ou `nome` com " +
          "menos de 2 caracteres. Os campos do corpo podem ser omitidos.",
          "nome",
          "String must contain at least 2 character(s)",
          "too_small",
        ),
        401: unauthorized,
        403: forbidden,
        404: sectorNotFound,
        429: rateLimit429("A atualização foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao atualizar o setor. O controller retorna `{ error }` " +
          "com a mensagem da exceção; apenas o código Prisma `P2025` é convertido em 404.",
        ),
      },
    },
  }, ctl.patch)

  app.delete('/setores/:id', {
    ...handlers,
    schema: {
      tags: [TAG],
      summary: "Excluir setor",
      description:
        "Exclui definitivamente o setor identificado por `id`. Os vínculos de " +
        "usuários relacionados são removidos em cascata pelo banco de dados. " +
        "A validação do parâmetro exige uma string não vazia; a existência do " +
        "setor é verificada durante a exclusão.\n\n" +
        "Requer token Bearer válido e perfil `ADMINISTRADOR`.",
      security,
      params: idParams,
      response: {
        // @fastify/swagger usa type null como marcador e o omite do OpenAPI final.
        204: {
          description:
            "Setor excluído com sucesso. Conforme o status HTTP 204, a resposta " +
            "não contém corpo.",
          headers: RateLimitHeaders,
          type: "null",
        },
        400: validationError(
          "Falha na validação Zod dos parâmetros. O formato é `{ message, issues }`; " +
          "ocorre, por exemplo, quando `id` é uma string vazia.",
          "id",
          "String must contain at least 1 character(s)",
          "too_small",
        ),
        401: unauthorized,
        403: forbidden,
        404: sectorNotFound,
        429: rateLimit429("A exclusão foi recusada antes do controller porque o cliente excedeu o limite global."),
        500: databaseError(
          "Falha inesperada ao excluir o setor. O controller retorna `{ error }` " +
          "com a mensagem da exceção; apenas o código Prisma `P2025` é convertido em 404.",
        ),
      },
    },
  }, ctl.removeHard)
}
