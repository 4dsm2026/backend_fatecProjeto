// src/core/sessions/sessions.routes.ts
import type { FastifyInstance } from "fastify";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { deleteCurrentSession, getCurrentSession, getCurrentUser } from "./sessions.controller";

const ProblemSchema = {
  type: "object",
  title: "Problem",
  description: "Erro no formato RFC 7807 (`application/problem+json`).",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string", example: "/errors/unauthorized" },
    title: { type: "string", example: "Token inválido ou expirado" },
    status: { type: "integer", example: 401 },
    detail: { type: "string" },
    instance: { type: "string", example: "/sessions/current" },
  },
} as const;

const LinkSchema = {
  type: "object",
  properties: {
    href: { type: "string", example: "/users/me" },
    method: { type: "string", example: "GET" },
  },
} as const;

const problem = (description: string) => ({ ...ProblemSchema, description });

export default async function sessionsRoutes(app: FastifyInstance) {
  // O `schema` abaixo só alimenta o Swagger; a lógica real fica nos controllers.
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate as any);

  app.get(
    "/sessions/current",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Sessão atual",
        description:
          "Devolve a sessão (login) que originou o access token usado na requisição, com `_links` " +
          "(`logout`, `refresh`, `user`, `password`, `entry`). Responde 401 se a sessão foi encerrada ou expirou, " +
          "mesmo que o access token ainda não tenha vencido, e se o token não tiver `sid` (emitido antes dessa claim existir).",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: "Sessão ativa",
            type: "object",
            properties: {
              id: { type: "string" },
              criadoEm: { type: "string", format: "date-time" },
              ultimoUsoEm: { type: "string", format: "date-time" },
              expiraEm: { type: "string", format: "date-time" },
              ip: { type: "string", nullable: true },
              userAgent: { type: "string", nullable: true },
              _links: { type: "object", additionalProperties: LinkSchema },
            },
          },
          401: problem("Sem token, token inválido/expirado ou sessão encerrada (`WWW-Authenticate`)"),
        },
      },
    },
    getCurrentSession,
  );

  app.delete(
    "/sessions/current",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Encerrar a sessão atual (logout)",
        description:
          "Revoga a sessão do token usado na requisição; o refresh token dela deixa de funcionar. " +
          "Idempotente: sessão já encerrada também responde 204. O access token em si segue valendo até expirar (15 min).",
        security: [{ bearerAuth: [] }],
        response: {
          204: { description: "Sessão encerrada (sem corpo)", type: "null" },
          401: problem("Sem token, token inválido/expirado ou sem `sid` (`WWW-Authenticate`)"),
        },
      },
    },
    deleteCurrentSession,
  );

  app.get(
    "/users/me",
    {
      schema: {
        tags: ["Users"],
        summary: "Usuário logado",
        description:
          "Perfil completo do usuário do token (os mesmos campos públicos de `GET /auth/me`) com `_links`. " +
          "Os links dependem do papel: `update` e os de conta valem para todos; os de menu (`users`, `roles`, " +
          "`audit-logs`...) só aparecem para quem pode usá-los.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: "Usuário logado",
            type: "object",
            additionalProperties: true,
            properties: { _links: { type: "object", additionalProperties: LinkSchema } },
          },
          401: problem("Sem token ou token inválido/expirado (`WWW-Authenticate`)"),
          404: problem("O usuário do token não existe mais"),
        },
      },
    },
    getCurrentUser,
  );
}
