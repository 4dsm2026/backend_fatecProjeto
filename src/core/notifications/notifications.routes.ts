// src/core/notifications/notifications.routes.ts
import type { FastifyInstance } from "fastify";
import {
  listNotificationsHandler,
  patchNotificationHandler,
  patchAllNotificationsHandler,
  createTestNotificationHandler,
} from "./notifications.controller.js";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only.js";

/* ===================================================================
 * Schemas OpenAPI / Swagger — Formato HAL (Nível 3) e RFC 7807
 * =================================================================== */

const HalLinkSchema = {
  type: "object",
  required: ["href"],
  properties: {
    href: { type: "string", example: "/notifications/cmk9876543210987654321098" },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      example: "GET",
    },
    title: { type: "string", example: "Marcar como lida" },
    name: { type: "string" },
  },
} as const;

const PageInfoSchema = {
  type: "object",
  required: ["size", "number", "totalElements", "totalPages"],
  properties: {
    size: { type: "integer", example: 20 },
    number: { type: "integer", example: 0 },
    totalElements: { type: "integer", example: 42 },
    totalPages: { type: "integer", example: 3 },
  },
} as const;

const ProblemDetailsSchema = {
  type: "object",
  title: "ProblemDetails",
  required: ["type", "title", "status"],
  properties: {
    type: { type: "string", example: "/errors/not-found" },
    title: { type: "string", example: "Notificação não encontrada" },
    status: { type: "integer", example: 404 },
    detail: { type: "string", example: "Nenhuma notificação encontrada para o id informado" },
    instance: { type: "string", example: "/notifications/cmk9876543210987654321098" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "message"],
        properties: {
          field: { type: "string", example: "size" },
          message: { type: "string", example: "Number must be less than or equal to 100" },
        },
      },
    },
  },
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
  description: "Limite de requisições excedido (100 req/min por IP).",
  headers: {
    ...RateLimitHeaders,
    "retry-after": {
      type: "integer",
      description: "Segundos que o cliente deve esperar antes de tentar novamente.",
    },
  },
  ...ProblemDetailsSchema,
} as const;

const NotificacaoResourceSchema = {
  type: "object",
  title: "NotificacaoResource",
  required: ["id", "usuarioId", "titulo", "mensagem", "tipo", "canal", "criadoEm", "_links"],
  properties: {
    id: { type: "string", example: "cmk9876543210987654321098" },
    usuarioId: {
      type: "string",
      description: "Sempre o próprio usuário autenticado.",
    },
    titulo: { type: "string", example: "Novo chamado atribuído" },
    mensagem: { type: "string", example: "Você foi atribuído ao chamado TCK-123." },
    tipo: {
      type: "string",
      enum: [
        "CHAMADO_CRIADO",
        "CHAMADO_ATRIBUIDO",
        "CHAMADO_ATUALIZADO",
        "STATUS_ALTERADO",
        "MENSAGEM_NOVA",
        "ANEXO_NOVO",
        "SISTEMA",
      ],
    },
    canal: { type: "string", enum: ["IN_APP", "EMAIL", "PUSH"], default: "IN_APP" },
    criadoEm: { type: "string", format: "date-time" },
    lidaEm: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Preenchido quando lida (`PATCH /notifications/{id}` com `{ lida: true }`).",
    },
    arquivadaEm: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Preenchido quando arquivada (`PATCH /notifications/{id}` com `{ arquivada: true }`).",
    },
    erroEntrega: {
      type: "string",
      nullable: true,
    },
    meta: {
      type: "object",
      nullable: true,
      additionalProperties: true,
    },
    organizacaoId: { type: "string", nullable: true },
    chamadoId: { type: "string", nullable: true },
    mensagemId: { type: "string", nullable: true },
    anexoId: { type: "string", nullable: true },
    entregueEm: { type: "string", format: "date-time", nullable: true },
    _links: {
      type: "object",
      required: ["self"],
      properties: {
        self: HalLinkSchema,
        "mark-read": HalLinkSchema,
        "mark-unread": HalLinkSchema,
        archive: HalLinkSchema,
        unarchive: HalLinkSchema,
        ticket: HalLinkSchema,
      },
      additionalProperties: HalLinkSchema,
    },
  },
} as const;

export async function notificationsRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  app.addHook("preHandler", app.authenticate);

  // GET /notifications
  app.get(
    "/",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Listar as notificações do usuário autenticado (Coleção HAL)",
        description:
          "Retorna a coleção paginada (base 0) de notificações do usuário logado no formato HAL " +
          "(`_embedded.notifications`, `page`, `_links`). O link `mark-all-read` só é incluído " +
          "em `_links` quando existem notificações não lidas.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            apenasNaoLidas: {
              type: "string",
              enum: ["true", "false"],
              description: "Filtra por notificações não lidas quando `'true'`.",
            },
            arquivadas: {
              type: "string",
              enum: ["true", "false"],
              description: "Filtra por notificações arquivadas quando `'true'` (padrão exibe não arquivadas).",
            },
          },
        },
        response: {
          200: {
            description: "Coleção HAL de notificações do usuário.",
            type: "object",
            required: ["_embedded", "page", "_links"],
            properties: {
              _embedded: {
                type: "object",
                required: ["notifications"],
                properties: {
                  notifications: {
                    type: "array",
                    items: NotificacaoResourceSchema,
                  },
                },
              },
              page: PageInfoSchema,
              _links: {
                type: "object",
                required: ["self", "first", "last"],
                properties: {
                  self: HalLinkSchema,
                  first: HalLinkSchema,
                  last: HalLinkSchema,
                  prev: HalLinkSchema,
                  next: HalLinkSchema,
                  "mark-all-read": HalLinkSchema,
                },
                additionalProperties: HalLinkSchema,
              },
            },
          },
          400: {
            description: "Parâmetros de query inválidos (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          401: {
            description: "Não autenticado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          429: RateLimit429Response,
          500: {
            description: "Erro interno inesperado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
        },
      },
    },
    listNotificationsHandler,
  );

  // PATCH /notifications
  app.patch(
    "/",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Marcar todas as notificações do usuário como lidas",
        description:
          "Marca em lote todas as notificações não lidas do usuário autenticado como lidas " +
          "enviando `{ \"lida\": true }`.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["lida"],
          properties: {
            lida: { type: "boolean", enum: [true], example: true },
          },
        },
        response: {
          200: {
            description: "Quantidade de notificações marcadas como lidas com links HAL.",
            type: "object",
            required: ["updatedCount", "_links"],
            properties: {
              updatedCount: { type: "integer", example: 5 },
              _links: {
                type: "object",
                required: ["self"],
                properties: {
                  self: HalLinkSchema,
                },
              },
            },
          },
          400: {
            description: "Corpo da requisição inválido (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          401: {
            description: "Não autenticado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          429: RateLimit429Response,
          500: {
            description: "Erro interno inesperado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
        },
      },
    },
    patchAllNotificationsHandler,
  );

  // PATCH /notifications/:id
  app.patch(
    "/:id",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Atualizar estado de uma notificação (lida / arquivada)",
        description:
          "Altera o estado de leitura (`lida: true | false`) e/ou arquivamento " +
          "(`arquivada: true | false`) de uma notificação do próprio usuário autenticado, " +
          "retornando o recurso HAL com os `_links` contextuais recalculados.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmk9876543210987654321098" },
          },
        },
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            lida: { type: "boolean", example: true },
            arquivada: { type: "boolean", example: false },
          },
        },
        response: {
          200: {
            description: "Notificação atualizada com seus novos links HAL.",
            ...NotificacaoResourceSchema,
          },
          400: {
            description: "Parâmetros ou corpo inválidos (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          401: {
            description: "Não autenticado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          404: {
            description:
              "Notificação não encontrada ou pertencente a outro usuário — proteção IDOR (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          429: RateLimit429Response,
          500: {
            description: "Erro interno inesperado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
        },
      },
    },
    patchNotificationHandler,
  );

  // POST /notifications/test
  app.post(
    "/test",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Criar uma notificação de teste para o próprio usuário",
        description:
          "Cria uma notificação interna de teste para o usuário autenticado e retorna " +
          "`201 Created` com header `Location` e corpo no formato HAL.",
        security: [{ bearerAuth: [] }],
        response: {
          201: {
            description: "Notificação de teste criada.",
            headers: {
              Location: {
                type: "string",
                description: "URI do recurso criado (`/notifications/{id}`).",
                example: "/notifications/cmk9876543210987654321098",
              },
            },
            ...NotificacaoResourceSchema,
          },
          401: {
            description: "Não autenticado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
          429: RateLimit429Response,
          500: {
            description: "Erro interno inesperado (RFC 7807).",
            ...ProblemDetailsSchema,
          },
        },
      },
    },
    createTestNotificationHandler,
  );
}