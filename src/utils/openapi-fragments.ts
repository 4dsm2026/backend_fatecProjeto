// src/utils/openapi-fragments.ts
//
// Fragmentos de schema OpenAPI GENUINAMENTE genéricos — não específicos do
// módulo de Auth — reaproveitáveis por qualquer arquivo de rotas do projeto
// (auth.routes.ts, anexos.routes.ts, e potencialmente os arquivos de rotas
// de outros módulos: tickets, usuários, admin, etc.).
//
// Critério para um fragmento estar aqui: a MESMA causa de infraestrutura
// (o mesmo plugin, o mesmo helper) precisa poder gerar essa resposta em
// qualquer endpoint da API, independente de módulo. Fragmentos específicos
// de um domínio (ex.: os 28 campos de UsuarioPublico, mensagens de senha)
// continuam no arquivo de rotas do próprio módulo.

/* ===================== 400 — falha de validação Zod ===================== */
// Corpo devolvido por formatZodError (src/utils/zod-helpers.ts) sempre que um
// preHandler construído com buildRouteValidator rejeita body/query/params.
export const ValidationErrorSchema = {
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

/* ===================== 429 — rate limit global ===================== */
// O @fastify/rate-limit é registrado globalmente (src/plugins/rateLimit.ts,
// `global: true`, 100 req/min por IP) e se aplica a TODAS as rotas da API,
// de qualquer módulo. Corpo exato do errorResponseBuilder configurado no plugin.
export const RateLimitErrorSchema = {
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
export const RateLimitHeaders = {
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

// Fragmento COMPLETO da resposta 429 (description + headers + corpo), pronto
// para ser usado como `429: RateLimit429Response` em qualquer endpoint da API.
export const RateLimit429Response = {
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
  ...RateLimitErrorSchema,
} as const;

/* ===================== Exemplos genéricos reutilizáveis ===================== */
// Exemplo ilustrativo de mensagem crua de exceção interna (ex.: Prisma, driver
// de banco), usado em qualquer endpoint cujo catch genérico devolve
// `error: err.message` sem sanitizar — padrão encontrado em vários controllers
// do projeto, não só no de Auth.
export const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";

/* ===================== 401 — não autenticado/autorizado ===================== */
// Corpo exato enviado por src/plugins/auth-verify.ts quando o token de acesso
// está ausente, malformado, inválido ou expirado (auth-verify.ts não
// distingue a causa: qualquer falha vira este mesmo 401 genérico). Aplica-se
// a qualquer rota cujo preHandler inclua `app.authenticate`.
export const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

// Corpo do 401 alternativo: NÃO vem de auth-verify.ts, é um padrão repetido
// manualmente por vários handlers (ex.: auth.controller.ts:me/trocarSenha,
// anexos.controller.ts:download/upload/generateDownloadTokenRoute) que fazem
// sua própria checagem `if (!req.user?.sub)` — teoricamente só dispararia se
// um token passasse na verificação de assinatura/expiração mas não tivesse a
// claim `sub` no payload, o que não deveria acontecer com tokens emitidos por
// este backend. Mensagem idêntica em todos os handlers que fazem essa checagem.
export const SelfCheckUnauthenticatedSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

// Resposta 401 combinada, usada em endpoints que têm as DUAS checagens
// (auth-verify.ts + checagem própria do próprio handler).
export const Unauthorized401WithSelfCheck = {
  description:
    "Token ausente, malformado, inválido ou expirado — verificado pelo " +
    "preHandler `app.authenticate` (`{ error: \"Não autorizado\" }`, o caso " +
    "comum) — OU token sintaticamente válido mas sem a claim `sub` no " +
    "payload — checagem redundante feita pelo próprio handler " +
    "(`{ error: \"Não autenticado\" }`, praticamente inatingível em uso " +
    "normal, já que todo token emitido por este backend sempre inclui `sub`).",
  oneOf: [UnauthorizedErrorSchema, SelfCheckUnauthenticatedSchema],
} as const;
