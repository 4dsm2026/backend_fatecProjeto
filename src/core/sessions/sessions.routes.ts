// src/core/sessions/sessions.routes.ts
import type { FastifyInstance } from "fastify";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { deleteCurrentSession, getCurrentSession, getCurrentUser } from "./sessions.controller";
import { postSession } from "./sessions.login";
import { postToken } from "./sessions.tokens";

const LinkSchema = {
  type: "object",
  properties: {
    href: { type: "string", example: "/users/me" },
    method: { type: "string", example: "GET" },
  },
} as const;

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
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    attemptsLeft: { type: "integer" },
    retryAfter: { type: "integer" },
    _links: { type: "object", additionalProperties: LinkSchema },
  },
} as const;

const problem = (description: string) => ({ ...ProblemSchema, description });

export default async function sessionsRoutes(app: FastifyInstance) {
  // O `schema` abaixo só alimenta o Swagger; a lógica real fica nos controllers.
  useDocsOnlySchemas(app);

  app.get(
    "/sessions/current",
    {
      preHandler: [app.authenticate],
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
      preHandler: [app.authenticate],
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
      preHandler: [app.authenticate],
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

  app.post(
    "/sessions",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Criar sessão (login)",
        description:
          "Endpoint público. Autentica com exatamente um identificador (`email` ou `ra`) e senha. " +
          "Após cinco senhas incorretas, a tentativa que causa o bloqueio ainda responde 401; " +
          "somente a tentativa seguinte responde 429 com `Retry-After`. Se for necessário trocar " +
          "a senha no primeiro acesso, responde 403 com `type: /errors/password-change-required` " +
          "e o link `activate`.",
        security: [],
        body: {
          description: "Informe `email` ou `ra`, mas não ambos. A senha é obrigatória.",
          oneOf: [
            {
              type: "object",
              title: "LoginPorEmail",
              required: ["email", "password"],
              not: { required: ["ra"] },
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 8 },
              },
            },
            {
              type: "object",
              title: "LoginPorRA",
              required: ["ra", "password"],
              not: { required: ["email"] },
              properties: {
                ra: { type: "string" },
                password: { type: "string", minLength: 8 },
              },
            },
          ],
        },
        response: {
          201: {
            description: "Sessão criada",
            headers: {
              Location: { type: "string", description: "URL da sessão criada.", example: "/sessions/current" },
              "Cache-Control": { type: "string", description: "Resposta com tokens: nunca vai para cache.", example: "no-store" },
            },
            type: "object",
            required: ["user", "accessToken", "refreshToken", "_links"],
            properties: {
              user: {
                type: "object",
                required: ["id", "nome", "ra", "papel", "emailPessoal", "ativo", "precisaTrocarSenha"],
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                  ra: { type: "string", nullable: true },
                  papel: { type: "string" },
                  emailPessoal: { type: "string", nullable: true },
                  ativo: { type: "boolean" },
                  precisaTrocarSenha: { type: "boolean" },
                },
              },
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              _links: { type: "object", additionalProperties: LinkSchema },
            },
          },
          400: problem("Corpo inválido"),
          401: problem("Credenciais inválidas; pode incluir `attemptsLeft`"),
          403: problem("Usuário inativo ou troca de senha obrigatória no primeiro acesso"),
          429: {
            ...problem("Conta bloqueada; informa `Retry-After` e `retryAfter`"),
            headers: {
              "Retry-After": { type: "integer", description: "Segundos até poder tentar de novo.", example: 900 },
            },
          },
        },
      },
    },
    postSession,
  );

  app.post(
    "/tokens",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Renovar o acesso (novo access token)",
        description:
          "Endpoint público: a credencial é o refresh token enviado no corpo. " +
          "O refresh token é rotacionado e o anterior deixa de valer. Responde 401 " +
          "se o refresh token estiver inválido, revogado ou expirado, ou se o usuário " +
          "estiver inativo, apagado ou não existir.",
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string", minLength: 20 },
          },
        },
        response: {
          201: {
            description: "Tokens renovados e refresh token rotacionado",
            headers: {
              "Cache-Control": {
                type: "string",
                description: "Resposta com tokens: nunca vai para cache.",
                example: "no-store",
              },
            },
            type: "object",
            required: ["accessToken", "refreshToken", "_links"],
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              _links: { type: "object", additionalProperties: LinkSchema },
            },
          },
          400: problem("Corpo inválido"),
          401: problem("Refresh token inválido, revogado ou expirado"),
        },
      },
    },
    postToken,
  );
}
