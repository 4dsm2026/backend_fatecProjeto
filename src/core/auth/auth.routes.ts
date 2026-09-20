import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  login,
  refresh,
  logout,
  me,
  register,
  getUser,
  firstAccess,
  forgotPassword,
  resetPassword,
  trocarSenha,
} from "./auth.controller";
import {
  buildRouteValidator,
  zEmail,
  zStringTrim,
} from "../../utils/zod-helpers";
import { z } from "zod";
import {
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  FirstAccessSchema,
  EsqueciSenhaSchema,
  ResetSenhaSchema,
} from "../../validators/auth";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

/* ===================== Fragmentos reutilizáveis do erro 400 ===================== */
// Corpo devolvido por formatZodError (src/utils/zod-helpers.ts) quando o
// preHandler rejeita o body por falha de schema.
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
          path: { type: "string", example: "newPassword" },
          message: { type: "string", example: "Mínimo de 8 caracteres" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

/* ===================== Fragmentos reutilizáveis do 429 (rate limit) ===================== */
// O @fastify/rate-limit é registrado globalmente (src/plugins/rateLimit.ts,
// `global: true`, 100 req/min por IP) e se aplica a TODAS as rotas da API,
// inclusive esta. Por isso o 429 é documentado em todos os endpoints, não só
// nos de auth. Corpo exato do errorResponseBuilder configurado no plugin.
const RateLimitErrorSchema = {
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

// Headers que o @fastify/rate-limit adiciona por padrão em toda resposta
// (addHeadersOnExceeding), enquanto o limite ainda não foi atingido.
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

const GetUserQuerySchema = z.object({
  ra: zStringTrim.optional(),
  email: zEmail.optional(),
  id: zStringTrim.optional(),
  name: zStringTrim.optional(),
  educationalEmail: zEmail.optional(),
});

const preBody =
  (schema: z.ZodTypeAny) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const v = buildRouteValidator({ body: schema }).parse(req);
      if ("error" in v) {
        await reply.code(400).send(v.error);
      }
    };

const preQuery =
  (schema: z.ZodTypeAny) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const v = buildRouteValidator({ query: schema }).parse(req);
      if ("error" in v) {
        await reply.code(400).send(v.error);
      }
    };

export default async function authRoutes(app: FastifyInstance) {
  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod (preHandler),
  // exatamente como já era antes desta alteração. Ver o porquê detalhado em
  // src/utils/openapi-docs-only.ts.
  useDocsOnlySchemas(app);

  app.post("/login", { preHandler: [preBody(LoginSchema)] }, login);
  app.post("/refresh", { preHandler: [preBody(RefreshSchema)] }, refresh);
  app.post("/logout", { preHandler: [preBody(RefreshSchema)] }, logout);
  app.post("/register", { preHandler: [preBody(RegisterSchema)] }, register);
  app.post(
    "/primeiro-acesso",
    {
      preHandler: [preBody(FirstAccessSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Concluir o primeiro acesso (definir senha inicial)",
        description:
          "Endpoint público (não exige `Authorization`) usado para o usuário definir " +
          "a própria senha na primeira vez que acessa o sistema.\n\n" +
          "**Como o token chega ao usuário:** por e-mail, quando a conta é criada/" +
          "convidada (ver `enviarLinkPrimeiroAcesso`); OU devolvido no campo `token` " +
          "da resposta `428` de `POST /auth/login`, quando o usuário já existe mas " +
          "está com `precisaTrocarSenha=true`.\n\n" +
          "O token é de uso único e expira em 24 horas (é marcado como usado em " +
          "`usadoEm` assim que consumido com sucesso). Ao concluir com sucesso, a " +
          "API também cria uma sessão e define os cookies `accessToken` e " +
          "`refreshToken` (não HttpOnly) na resposta, além de devolvê-los no corpo.",
        security: [],
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token: {
              type: "string",
              minLength: 10,
              description:
                "Token bruto recebido por e-mail ou devolvido pelo campo `token` " +
                "da resposta 428 de POST /auth/login.",
              example: "3f1c9e2a7b8d4f0a91c6e5b2d8a7f4c1e0b9a8d7c6f5e4b3a2c1d0e9f8b7a6c5",
            },
            newPassword: {
              type: "string",
              minLength: 8,
              // Replica em uma única regra as 4 exigências do Zod: min. 8
              // caracteres, 1 minúscula, 1 maiúscula, 1 dígito e 1 símbolo.
              pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
              description:
                "Nova senha. Mínimo de 8 caracteres, com ao menos 1 letra " +
                "maiúscula, 1 minúscula, 1 número e 1 símbolo.",
              example: "NovaSenha1#",
            },
            personalEmail: {
              type: "string",
              format: "email",
              description:
                "E-mail pessoal a ser definido/atualizado no primeiro acesso " +
                "(opcional). Se já pertencer a outra conta, a API retorna 409.",
              example: "aluno@gmail.com",
            },
          },
        },
        response: {
          200: {
            description:
              "Primeiro acesso concluído: senha definida, sessão criada e " +
              "tokens de autenticação devolvidos.",
            type: "object",
            additionalProperties: true,
            headers: RateLimitHeaders,
            properties: {
              user: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string", example: "cmj1234567890123456789012" },
                  nome: { type: "string", example: "João Silva" },
                  papel: {
                    type: "string",
                    enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
                    example: "USUARIO",
                  },
                  emailPessoal: {
                    type: "string",
                    format: "email",
                    example: "aluno@gmail.com",
                  },
                },
              },
              accessToken: {
                type: "string",
                description:
                  "JWT de acesso (HS256). Expira conforme JWT_ACCESS_EXPIRES " +
                  "(padrão 15 minutos). Usar no header `Authorization: Bearer <token>`.",
              },
              refreshToken: {
                type: "string",
                description:
                  "Token opaco de sessão (NÃO é um JWT) — string aleatória, " +
                  "armazenada com hash SHA-256 no banco. Validade fixa de 7 dias. " +
                  "Usado em POST /auth/refresh e POST /auth/logout.",
              },
            },
          },
          400: {
            description:
              "Falha de validação. Três causas possíveis: " +
              "(1) corpo fora do schema (`token`/`newPassword` ausentes ou mal " +
              "formatados) — formato `{ message, issues[] }`; " +
              "(2) `newPassword` não atende à política mínima de senha; " +
              "(3) `token` inválido, já utilizado ou expirado. As causas (2) e " +
              "(3) usam o formato `{ error }`.",
            oneOf: [
              ValidationErrorSchema,
              {
                type: "object",
                title: "ErroDeRegraDeNegocio",
                required: ["error"],
                properties: {
                  error: {
                    type: "string",
                    enum: [
                      "Senha não atende aos critérios mínimos.",
                      "Token inválido ou expirado.",
                    ],
                  },
                },
              },
            ],
          },
          403: {
            description:
              "O usuário vinculado ao token está inativo (`ativo=false`) e não " +
              "pode concluir o primeiro acesso.",
            type: "object",
            properties: {
              error: { type: "string", example: "Usuário inativo" },
            },
          },
          409: {
            description: "O `personalEmail` informado já está em uso por outra conta.",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Este e-mail pessoal já está em uso",
              },
            },
          },
          429: {
            description:
              "Limite de requisições excedido: 100 requisições por minuto, por IP " +
              "(aplicado globalmente pelo @fastify/rate-limit — ver src/plugins/rateLimit.ts, " +
              "não é um limite específico para este endpoint).",
            headers: {
              ...RateLimitHeaders, "retry-after": {
                type: "integer",
                description: "Segundos que o cliente deve esperar antes de tentar novamente.",
              }
            },
            ...RateLimitErrorSchema,
          },
          500: {
            description: "Erro inesperado ao concluir o primeiro acesso.",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Erro ao concluir o primeiro acesso",
              },
            },
          },
        },
      },
    },
    firstAccess,
  );
  app.post("/esqueci-senha", { preHandler: [preBody(EsqueciSenhaSchema)] }, forgotPassword);
  app.post("/reset-senha", { preHandler: [preBody(ResetSenhaSchema)] }, resetPassword);
  app.get("/me", { preHandler: [app.authenticate] }, me);
  app.post("/trocar-senha", { preHandler: [app.authenticate] }, trocarSenha);
  app.get(
    "/usuarios",
    { preHandler: [app.authenticate, preQuery(GetUserQuerySchema)] },
    getUser,
  );
}