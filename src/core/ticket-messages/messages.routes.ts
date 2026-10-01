import type { FastifyInstance } from "fastify";
import { create, list } from "./messages.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

// ===================== Constantes reutilizáveis =====================

const EXAMPLE_TICKET_ID = "cmj1234567890123456789012";
const EXAMPLE_MESSAGE_ID = "cmjmsg12345678901234567a";
const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";

// ===================== Fragmentos reutilizáveis de schema =====================

const ValidationErrorSchema = {
  type: "object",
  title: "ErroDeValidacaoDeSchema",
  required: ["message", "issues"],
  properties: {
    message: { type: "string", example: "Validação falhou" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", example: "conteudo" },
          message: { type: "string", example: "conteudo é obrigatório" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

const SelfCheckUnauthenticatedSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

const Unauthorized401WithSelfCheck = {
  description:
    "Token ausente, malformado, inválido ou expirado — verificado pelo " +
    "preHandler `app.authenticate` (`{ error: \"Não autorizado\" }`, o caso " +
    "comum) — OU token sintaticamente válido mas sem a claim `sub` no " +
    "payload — checagem redundante feita pelo próprio handler " +
    "(`{ error: \"Não autenticado\" }`, praticamente inatingível em uso " +
    "normal, já que todo token emitido por este backend sempre inclui `sub`).",
  oneOf: [UnauthorizedErrorSchema, SelfCheckUnauthenticatedSchema],
} as const;

const RateLimitHeaders = {
  "x-ratelimit-limit": {
    type: "integer",
    description: "Quantas requisições o cliente pode fazer na janela atual (100/min por IP).",
  },
  "x-ratelimit-remaining": {
    type: "integer",
    description: "Quantas requisições ainda restam nessa janela de 1 minuto.",
  },
  "x-ratelimit-reset": {
    type: "integer",
    description: "Segundos até a janela atual de rate limit reiniciar.",
  },
} as const;

const RateLimit429Response = {
  description:
    "Limite de requisições excedido: 100 requisições por minuto, por IP " +
    "(aplicado globalmente pelo @fastify/rate-limit — ver src/plugins/rateLimit.ts, " +
    "não é um limite específico deste endpoint).",
  headers: {
    ...RateLimitHeaders,
    "retry-after": {
      type: "integer",
      description: "Segundos que o cliente deve esperar antes de tentar novamente.",
    },
  },
  type: "object",
  title: "ErroDeRateLimit",
  properties: {
    statusCode: { type: "integer", example: 429 },
    error: { type: "string", example: "Too Many Requests" },
    message: {
      type: "string",
      example: "Limite de requisições atingido. Tente novamente em 42s.",
    },
  },
} as const;

const NotFoundChamadoResponse = {
  description:
    "Chamado não encontrado. Retornado tanto quando o ID do chamado não " +
    "existe no banco (ou foi soft-deletado) quanto quando um aluno (papel " +
    "`USUARIO`) tenta acessar mensagens de um chamado de outro usuário — " +
    "a mesma resposta 404 é usada em ambos os cenários para não vazar a " +
    "existência do recurso (anti-IDOR). Também retornado quando o Prisma " +
    "lança `P2025` (registro requerido não encontrado).",
  type: "object",
  properties: {
    error: { type: "string", example: "Chamado não encontrado" },
  },
} as const;

// Schema reutilizável de uma mensagem com autor incluído.
const MensagemSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", example: EXAMPLE_MESSAGE_ID },
    chamadoId: { type: "string", example: EXAMPLE_TICKET_ID },
    autorId: { type: "string" },
    conteudo: { type: "string", example: "Olá, gostaria de informar que o problema persiste." },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
    autor: {
      type: "object",
      description: "Dados públicos do autor da mensagem.",
      properties: {
        id: { type: "string" },
        nome: { type: "string", example: "João Silva" },
        emailPessoal: { type: "string", format: "email", example: "joao@example.com" },
      },
    },
  },
} as const;

export async function ticketMessagesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod (preHandler).
  useDocsOnlySchemas(app);

  // POST /tickets/:id/mensagens
  app.post(
    "/:id/mensagens",
    {
      schema: {
        tags: ["Mensagens de Chamados"],
        summary: "Criar uma nova mensagem em um chamado",
        description:
          "Adiciona uma nova mensagem de texto a um chamado existente. O autor é " +
          "determinado automaticamente pelo `sub` do JWT do usuário autenticado.\n\n" +
          "**Regra de acesso anti-IDOR:** alunos (papel `USUARIO`) só conseguem " +
          "enviar mensagens em chamados que eles próprios criaram. Tentar enviar " +
          "em chamado de outro aluno resulta em `404` (não `403`), para não " +
          "vazar a existência do recurso.\n\n" +
          "**Efeitos colaterais:**\n" +
          "- **WebSocket broadcast:** ao criar a mensagem, um evento `nova_mensagem` " +
          "é disparado via WebSocket para todos os clientes conectados (via " +
          "`broadcastWS` global).\n" +
          "- **Notificação persistente:** notificações IN_APP são enviadas ao " +
          "criador do chamado, ao responsável e aos membros do setor vinculado " +
          "(excluindo o próprio autor da mensagem).\n\n" +
          "**Nota sobre o chamado:** o chamado precisa existir e NÃO estar " +
          "soft-deletado. Se o chamado existir mas o Prisma lançar `P2025` por " +
          "qualquer motivo (condição de corrida), a resposta é `404`.",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string", minLength: 1,
              description: "ID do chamado (CUID) ao qual a mensagem será adicionada.",
              example: EXAMPLE_TICKET_ID,
            },
          },
        },
        body: {
          type: "object",
          required: ["conteudo"],
          properties: {
            conteudo: {
              type: "string",
              minLength: 1,
              description:
                "Conteúdo textual da mensagem. Não pode ser vazio. Sem limite " +
                "máximo definido no schema (limitado apenas pelo banco).",
              example: "Olá, gostaria de informar que o problema persiste.",
            },
          },
        },
        response: {
          201: {
            description:
              "Mensagem criada com sucesso. Retorna a mensagem com os dados do " +
              "autor incluídos (id, nome, emailPessoal).",
            ...MensagemSchema,
          },
          400: {
            description:
              "Body ou parâmetros inválidos. Possíveis causas:\n" +
              "- `conteudo` ausente ou vazio (string vazia).\n" +
              "- Parâmetro `id` ausente ou vazio.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: NotFoundChamadoResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao criar a mensagem. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada — pode conter detalhes " +
              "internos do banco de dados.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    create,
  );

  // GET /tickets/:id/mensagens
  app.get(
    "/:id/mensagens",
    {
      schema: {
        tags: ["Mensagens de Chamados"],
        summary: "Listar mensagens de um chamado (paginado)",
        description:
          "Retorna uma lista paginada de mensagens de um chamado específico. " +
          "Cada mensagem inclui os dados do autor (id, nome, emailPessoal).\n\n" +
          "**Regra de acesso anti-IDOR:** alunos (papel `USUARIO`) só conseguem " +
          "listar mensagens dos próprios chamados. Tentar acessar mensagens de " +
          "chamado de outro aluno resulta em `404`.\n\n" +
          "**Ordenação padrão:** mensagens são retornadas em ordem crescente " +
          "(`asc`) por `criadoEm` — ou seja, da mais antiga para a mais recente. " +
          "Pode ser invertido via `orderDir=desc`.\n\n" +
          "**Paginação:** `page` começa em 1, `pageSize` default é 100 (máximo 1000).",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string", minLength: 1,
              description: "ID do chamado (CUID) cujas mensagens serão listadas.",
              example: EXAMPLE_TICKET_ID,
            },
          },
        },
        querystring: {
          type: "object",
          properties: {
            page: {
              type: "integer", minimum: 1, default: 1,
              description: "Número da página (1-indexed).",
            },
            pageSize: {
              type: "integer", minimum: 1, maximum: 1000, default: 100,
              description: "Itens por página. Máximo: 1000.",
            },
            orderDir: {
              type: "string",
              enum: ["asc", "desc"],
              default: "asc",
              description:
                "Direção da ordenação por `criadoEm`. `asc` (padrão) = da mais " +
                "antiga para a mais recente.",
            },
          },
        },
        response: {
          200: {
            description: "Lista paginada de mensagens retornada com sucesso.",
            type: "object",
            additionalProperties: true,
            properties: {
              total: {
                type: "integer",
                description: "Total de mensagens neste chamado.",
                example: 12,
              },
              page: { type: "integer", description: "Página atual.", example: 1 },
              pageSize: { type: "integer", description: "Itens por página.", example: 100 },
              mensagens: {
                type: "array",
                description: "Mensagens da página atual, com dados do autor.",
                items: MensagemSchema,
              },
            },
          },
          400: {
            description:
              "Query string ou parâmetros inválidos. Possíveis causas:\n" +
              "- Parâmetro `id` ausente ou vazio.\n" +
              "- `page` menor que 1.\n" +
              "- `pageSize` menor que 1 ou maior que 1000.\n" +
              "- `orderDir` com valor não reconhecido.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: NotFoundChamadoResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao listar mensagens. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    list,
  );
}
