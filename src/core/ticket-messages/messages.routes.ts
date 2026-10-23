import type { FastifyInstance } from "fastify";
import { create, getOne, list } from "./messages.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

// ===================== Constantes reutilizáveis =====================

const EXAMPLE_TICKET_ID = "cmj1234567890123456789012";
const EXAMPLE_MESSAGE_ID = "cmjmsg12345678901234567a";

// ===================== Fragmentos reutilizáveis de schema =====================

// Erro no formato RFC 7807 (`application/problem+json`) — o handler global
// (src/hateoas/problem.ts) responde assim em TODAS as rotas.
const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string", example: "/errors/not-found" },
    title: { type: "string", example: "Chamado não encontrado" },
    status: { type: "integer", example: 404 },
    detail: { type: "string" },
    instance: { type: "string", example: `/tickets/${EXAMPLE_TICKET_ID}/messages` },
    errors: {
      type: "array",
      description: "Só nos erros de validação (400): um item por campo inválido.",
      items: {
        type: "object",
        required: ["field", "message"],
        properties: {
          field: { type: "string", example: "body.conteudo" },
          message: { type: "string", example: "conteudo é obrigatório" },
        },
      },
    },
  },
} as const;

const RateLimit429Response = {
  description: "Limite de requisições excedido: 100 por minuto, por IP (@fastify/rate-limit).",
  type: "object",
  additionalProperties: true,
} as const;

/** Formato do `_links` (HAL): cada `rel` tem um link ou uma lista de links. */
const HalLinksSchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Links HAL: `self` (a mensagem), `collection` (a conversa) e `ticket` (o chamado), " +
    "no formato `{ href, method }`.",
} as const;

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
    _links: HalLinksSchema,
  },
} as const;

const TicketIdParam = {
  type: "string",
  minLength: 1,
  description: "ID do chamado (CUID gerado pelo Prisma).",
  example: EXAMPLE_TICKET_ID,
} as const;

export async function ticketMessagesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod.
  useDocsOnlySchemas(app);

  // POST /tickets/:id/messages
  app.post(
    "/:id/messages",
    {
      schema: {
        tags: ["Mensagens de Chamados"],
        summary: "Criar uma nova mensagem em um chamado",
        description:
          "Cria uma mensagem na conversa do chamado e responde `201` com o header " +
          "`Location` apontando para a mensagem criada.\n\n" +
          "**Quando é permitido:** só enquanto o chamado aceita interação. Em `RESOLVIDO`, " +
          "`ENCERRADO` ou arquivado, ninguém responde (aluno ou equipe): é preciso reabrir antes. " +
          "A API avisa isso no chamado: o link `reply` só aparece quando a resposta é possível.\n\n" +
          "**Efeitos colaterais:** quando o dono responde em `AGUARDANDO_USUARIO`, o chamado volta " +
          "para `EM_ATENDIMENTO` (com histórico e notificação). Os envolvidos recebem uma notificação " +
          "`MENSAGEM_NOVA` e o evento `nova_mensagem` é emitido no WebSocket.\n\n" +
          "**Anti-IDOR:** aluno que não é dono do chamado recebe `404`.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: TicketIdParam },
        },
        body: {
          type: "object",
          required: ["conteudo"],
          properties: {
            conteudo: {
              type: "string",
              minLength: 1,
              description: "Texto da mensagem.",
              example: "Olá, gostaria de informar que o problema persiste.",
            },
          },
        },
        response: {
          201: {
            description: "Mensagem criada. O corpo traz a mensagem com `_links`.",
            headers: {
              Location: { type: "string", example: `/tickets/${EXAMPLE_TICKET_ID}/messages/${EXAMPLE_MESSAGE_ID}` },
            },
            ...MensagemSchema,
          },
          400: {
            description: "`conteudo` ausente ou vazio, ou `id` ausente.",
            ...ProblemSchema,
          },
          401: { description: "Token ausente, malformado, inválido ou expirado.", ...ProblemSchema },
          404: {
            description:
              "Chamado não encontrado, ou de outro aluno (a mesma resposta nos dois casos).",
            ...ProblemSchema,
          },
          409: {
            description: "O chamado está resolvido, encerrado ou arquivado e não aceita mensagens.",
            ...ProblemSchema,
          },
          429: RateLimit429Response,
          500: { description: "Erro inesperado. O corpo é genérico.", ...ProblemSchema },
        },
      },
    },
    create,
  );

  // GET /tickets/:id/messages
  app.get(
    "/:id/messages",
    {
      schema: {
        tags: ["Mensagens de Chamados"],
        summary: "Listar as mensagens de um chamado (paginado)",
        description:
          "Coleção HAL das mensagens do chamado, em `_embedded.messages`, com `page` e links " +
          "de paginação (`self`, `first`, `last`, `prev`, `next`). A primeira página é a `0`.\n\n" +
          "Por padrão vem da mais antiga para a mais nova (`orderDir=asc`). O `orderDir` é " +
          "repetido nos links de paginação.\n\n" +
          "**Anti-IDOR:** aluno que não é dono do chamado recebe `404`.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: TicketIdParam },
        },
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0, description: "Número da página (começa em 0)." },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Itens por página. Máximo: 100." },
            orderDir: { type: "string", enum: ["asc", "desc"], default: "asc", description: "Ordenação por data de criação." },
          },
        },
        response: {
          200: {
            description: "Coleção HAL paginada de mensagens.",
            type: "object",
            additionalProperties: true,
            properties: {
              _embedded: {
                type: "object",
                properties: {
                  messages: { type: "array", items: MensagemSchema },
                },
              },
              page: {
                type: "object",
                properties: {
                  size: { type: "integer", example: 20 },
                  number: { type: "integer", example: 0 },
                  totalElements: { type: "integer", example: 42 },
                  totalPages: { type: "integer", example: 3 },
                },
              },
              _links: HalLinksSchema,
            },
          },
          400: { description: "`page` negativo, `size` fora de 1–100 ou `orderDir` inválido.", ...ProblemSchema },
          401: { description: "Token ausente, malformado, inválido ou expirado.", ...ProblemSchema },
          404: {
            description: "Chamado de outro aluno (aluno não vê chamado alheio).",
            ...ProblemSchema,
          },
          429: RateLimit429Response,
          500: { description: "Erro inesperado. O corpo é genérico.", ...ProblemSchema },
        },
      },
    },
    list,
  );

  // GET /tickets/:id/messages/:messageId
  app.get(
    "/:id/messages/:messageId",
    {
      schema: {
        tags: ["Mensagens de Chamados"],
        summary: "Obter uma mensagem de um chamado",
        description:
          "Devolve uma mensagem com `_links`. É o endereço que o header `Location` do `POST` " +
          "e o `self` de cada item da coleção apontam.\n\n" +
          "**Anti-IDOR:** aluno que não é dono do chamado recebe `404`.",
        params: {
          type: "object",
          required: ["id", "messageId"],
          properties: {
            id: TicketIdParam,
            messageId: { type: "string", minLength: 1, example: EXAMPLE_MESSAGE_ID },
          },
        },
        response: {
          200: { description: "Mensagem encontrada.", ...MensagemSchema },
          401: { description: "Token ausente, malformado, inválido ou expirado.", ...ProblemSchema },
          404: { description: "Chamado ou mensagem não encontrados.", ...ProblemSchema },
          429: RateLimit429Response,
          500: { description: "Erro inesperado. O corpo é genérico.", ...ProblemSchema },
        },
      },
    },
    getOne,
  );
}