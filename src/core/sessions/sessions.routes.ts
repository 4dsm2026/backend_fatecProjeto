// src/core/sessions/sessions.routes.ts
import type { FastifyInstance } from "fastify";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import {
  deleteCurrentSession,
  getCurrentSession,
  getCurrentUser,
  putCurrentUserPassword,
} from "./sessions.controller";
import { putAccountActivation } from "./account-activations";
import { postPasswordReset, putPasswordReset } from "./password-resets";
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
          "Perfil completo do usuário do token (campos públicos, sem hash de senha) com `_links`. " +
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

  app.put(
    "/users/me/password",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Users"],
        summary: "Alterar a própria senha",
        description:
          "Altera a senha do usuário autenticado após validar a senha atual. A nova senha usa a política " +
          "oficial `zStrongPassword` e, em caso de sucesso, encerra TODAS as sessões ativas do usuário, inclusive a atual " +
          "(o cliente deve pedir um novo login) e retorna 204.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["senhaAtual", "novaSenha"],
          properties: {
            senhaAtual: { type: "string", minLength: 1, description: "Senha atual do usuário autenticado." },
            novaSenha: {
              type: "string",
              minLength: 8,
              description: "Nova senha: deve atender à política `zStrongPassword` (8+ caracteres, maiúscula, minúscula, número e símbolo).",
            },
          },
        },
        response: {
          204: { description: "Senha alterada com sucesso (sem corpo).", type: "null" },
          400: problem("Corpo inválido ou nova senha fora da política `zStrongPassword`"),
          401: problem("Sem token, token inválido/expirado (`WWW-Authenticate`)"),
          404: problem("Usuário autenticado não existe mais"),
          409: problem("Usuário sem senha local definida"),
          422: problem("Senha atual incorreta"),
        },
      },
    },
    putCurrentUserPassword,
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

  app.post(
    "/password-resets",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Pedir a redefinição de senha (esqueci minha senha)",
        description:
          "Endpoint público. Envia um link de redefinição (válido por 1 hora) para o e-mail informado, " +
          "**se** existir uma conta ativa com ele. A resposta é sempre `202` com a mesma mensagem, exista a conta " +
          "ou não, e o envio roda desacoplado: falhas de e-mail ou de banco não mudam a resposta.",
        security: [],
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", format: "email" } },
        },
        response: {
          202: {
            description: "Pedido recebido (não revela se a conta existe).",
            type: "object",
            required: ["message", "_links"],
            properties: {
              message: { type: "string" },
              _links: { type: "object", additionalProperties: LinkSchema },
            },
          },
          400: problem("E-mail inválido"),
        },
      },
    },
    postPasswordReset,
  );

  app.put(
    "/password-resets/:token",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Redefinir a senha com o token recebido por e-mail",
        description:
          "Endpoint público. O token vai no caminho. A nova senha usa a política `zStrongPassword`. Em caso de " +
          "sucesso encerra TODAS as sessões do usuário, avisa por e-mail e responde `204` sem corpo: **não** " +
          "cria sessão (o login é `POST /sessions`). Um token de primeiro acesso não vale aqui.",
        security: [],
        params: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", description: "Token do link enviado por e-mail." } },
        },
        body: {
          type: "object",
          required: ["novaSenha"],
          properties: {
            novaSenha: {
              type: "string",
              minLength: 8,
              description: "Nova senha: 8+ caracteres, maiúscula, minúscula, número e símbolo.",
            },
          },
        },
        response: {
          204: { description: "Senha redefinida (sem corpo).", type: "null" },
          400: problem("Nova senha fora da política `zStrongPassword`"),
          404: problem("Token inexistente, expirado, de outra finalidade ou de conta inativa/apagada"),
          409: problem("Token já utilizado"),
        },
      },
    },
    putPasswordReset,
  );

  app.put(
    "/account-activations/:token",
    {
      schema: {
        tags: ["Sessions"],
        summary: "Concluir o primeiro acesso (definir a senha)",
        description:
          "Endpoint público. O token vem no link `activate` do `403 password-change-required` do `POST /sessions` " +
          "e vai no caminho. Define a nova senha (política `zStrongPassword`) e, opcionalmente, o e-mail pessoal. " +
          "Responde `204` sem corpo e **sem sessão**: o login é `POST /sessions`. Concluir invalida os outros " +
          "tokens de primeiro acesso pendentes do usuário. Um token de reset de senha não vale aqui.",
        security: [],
        params: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", description: "Token do link `activate`." } },
        },
        body: {
          type: "object",
          required: ["novaSenha"],
          properties: {
            novaSenha: {
              type: "string",
              minLength: 8,
              description: "Nova senha: 8+ caracteres, maiúscula, minúscula, número e símbolo.",
            },
            emailPessoal: { type: "string", format: "email", description: "Opcional: novo e-mail pessoal da conta." },
          },
        },
        response: {
          204: { description: "Conta ativada (sem corpo).", type: "null" },
          400: problem("Senha fora da política ou e-mail inválido"),
          403: problem("Usuário inativo"),
          404: problem("Token inexistente, expirado, de outra finalidade, de conta apagada ou que não precisa mais trocar a senha"),
          409: problem("Token já utilizado, ou e-mail pessoal já em uso por outra conta"),
        },
      },
    },
    putAccountActivation,
  );
}
