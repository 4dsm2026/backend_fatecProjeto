// core/notifications/notifications.routes.ts
import type { FastifyInstance } from "fastify";
import {
  list,
  readOne,
  archive,
  unarchive,
  readAll,
  createTest,
} from "./notifications.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

/* ===================================================================
 * Fragmentos reutilizáveis de documentação (OpenAPI/Swagger).
 * Mesma convenção de src/core/auth/auth.routes.ts e
 * src/core/users/users.routes.ts: cada arquivo de rotas declara os
 * próprios fragmentos (não há módulo compartilhado no projeto). Os
 * nomes abaixo coincidem com os de users.routes.ts em alguns casos,
 * mas são constantes independentes — só por coincidência os corpos
 * são idênticos nesses casos (mesmos helpers `formatZodError` e
 * `app.authenticate` usados nos dois módulos).
 * =================================================================== */

// ⚠️ "Notificação não encontrado" — sem concordância de gênero (deveria ser
// "encontrada"). Vem do helper genérico `sendNotFound(res, resource)` em
// src/utils/http.ts, que monta a frase como `${resource} não encontrado`
// (funciona para "Usuário", não funciona para um recurso feminino como
// "Notificação"). Confirmei que é mesmo isso que a API devolve — tem até um
// teste já existente no repo que espera a forma correta ("encontrada") e
// FALHA contra o comportamento real (`tests/core/notifications/notifications.controller.test.ts`,
// casos "404" de readOne/archive/unarchive) — ou seja, isso não é uma
// suposição minha, é um bug já pego pelo próprio teste do time, só que
// ninguém corrigiu `sendNotFound` nem atualizou o teste ainda.
const EXAMPLE_NOTIFICATION_NOT_FOUND = "Notificação não encontrado";

/* ----------------------- Erro 400 (Zod) ----------------------- */
// Mesmo formato em `list` (via sendValidationError) e em
// readOne/archive/unarchive (via validateIdOrBadRequest) — os dois
// caminhos usam o mesmo formatZodError por trás.
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
          path: { type: "string", example: "pageSize" },
          message: { type: "string", example: "Number must be less than or equal to 1000" },
          code: { type: "string", example: "too_big" },
        },
      },
    },
  },
} as const;

/* ----------------------- Erro 401 ----------------------- */
// Este arquivo (diferente de users.routes.ts) tem DOIS formatos
// possíveis de 401, vindos de dois lugares diferentes:
const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  description:
    "Vem do hook `app.authenticate` (src/plugins/auth-verify.ts), aplicado a TODAS as " +
    "rotas deste plugin via `app.addHook('preHandler', app.authenticate)` — token " +
    "ausente, malformado, inválido ou expirado.",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

// Vem de `requireUserId` (notifications.controller.ts), chamado em TODOS
// os 6 handlers deste arquivo — dispara se `app.authenticate` passou (token
// válido) mas `req.user.sub` está ausente. Como todo token emitido por
// `generateAccessToken` neste projeto sempre inclui `sub` (conferido em
// src/core/auth/auth.controller.ts e src/utils/jwt.ts), isso é, na prática,
// inatingível com um token normal deste sistema.
const NotAuthenticatedErrorSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  description:
    "Formato alternativo de 401 (ver `UnauthorizedErrorSchema`) — praticamente " +
    "inatingível com tokens emitidos normalmente por este sistema.",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

/* ----------------------- Erro 429 (rate limit) ----------------------- */
// @fastify/rate-limit global (src/plugins/rateLimit.ts) — 100 req/min por
// IP, se aplica a todas as rotas da API, inclusive as deste arquivo.
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
  ...RateLimitErrorSchema,
} as const;

/* ----------------------- Recurso "Notificação" ----------------------- */
// Espelha EXATAMENTE o `select` de `listNotifications`
// (src/core/notifications/notifications.service.ts, 15 campos). Nulidade
// de cada campo conferida contra `model Notificacao` em
// prisma/schema.prisma. Note que o model tem um campo `entregueEm`
// (DateTime?) que NÃO está nesse `select` — ou seja, `entregueEm` existe
// no banco mas nunca é devolvido por nenhum endpoint deste arquivo.
const NotificacaoSchema = {
  type: "object",
  title: "Notificacao",
  properties: {
    id: { type: "string", example: "cmk9876543210987654321098" },
    usuarioId: {
      type: "string",
      description: "Sempre o próprio usuário autenticado — todos os endpoints deste arquivo escopam por `usuarioId`.",
    },
    titulo: { type: "string", example: "Novo chamado atribuído a você" },
    mensagem: { type: "string" },
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
      description: "Preenchido por PATCH /notifications/{id}/lida. Nulo = não lida.",
    },
    arquivadaEm: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Preenchido por POST /notifications/{id}/archive. Nulo = não arquivada.",
    },
    erroEntrega: {
      type: "string",
      nullable: true,
      description: "Mensagem de erro de entrega (ex.: falha ao enviar e-mail/push), se houver.",
    },
    meta: {
      type: "object",
      nullable: true,
      additionalProperties: true,
      description: "JSON livre com dados extras específicos do tipo de notificação (ex.: `{ url: \"/dashboard\" }`).",
    },
    organizacaoId: { type: "string", nullable: true },
    chamadoId: { type: "string", nullable: true },
    mensagemId: { type: "string", nullable: true },
    anexoId: { type: "string", nullable: true },
  },
} as const;

export async function notificationsRoutes(app: FastifyInstance) {
  // Só afeta a geração de doc no @fastify/swagger — a validação real
  // continua 100% via Zod (buildRouteValidator), sem mudança de
  // comportamento. Ver src/utils/openapi-docs-only.ts.
  useDocsOnlySchemas(app);

  app.addHook("preHandler", app.authenticate as any);

  // GET /notifications
  app.get(
    "/",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Listar as notificações do usuário autenticado",
        description:
          "Lista as notificações do próprio usuário (escopado por `usuarioId` — nunca " +
          "retorna notificação de outra pessoa). **Qualquer papel autenticado** pode " +
          "chamar este endpoint — não há `app.authorize(...)` em nenhuma rota deste " +
          "arquivo, só o hook `app.authenticate` aplicado a todas elas.\n\n" +
          "**⚠️ `apenasNaoLidas` tem um comportamento de `z.coerce.boolean()` que engana " +
          "fácil.** `z.coerce.boolean()` faz `Boolean(valor)` — ou seja, **qualquer " +
          "string não vazia vira `true`, incluindo a string `\"false\"`**. Só omitir o " +
          "parâmetro (o `.default(false)` entra em ação antes da coerção) resulta em " +
          "`false` de verdade. Na prática: `?apenasNaoLidas=false` filtra como se fosse " +
          "`true`; o único jeito confiável de pedir 'todas' é não enviar o parâmetro.\n\n" +
          "**`apenasNaoLidas=true` também exclui as arquivadas** (o filtro real é " +
          "`lidaEm: null AND arquivadaEm: null`) — e não existe um filtro equivalente " +
          "para ver *só* as arquivadas; sem esse parâmetro, arquivadas e não arquivadas " +
          "aparecem juntas na mesma lista.\n\n" +
          "**`criadoDe`/`criadoAte` não validam formato de data — se o valor não for " +
          "uma data parseável, o filtro é silenciosamente ignorado** (`parseISO` em " +
          "`notifications.service.ts` devolve `undefined` e a condição nem entra no " +
          "`where`), sem gerar `400`. Diferente de outros validators do projeto (ex.: " +
          "`zDateISO` em `zod-helpers.ts`), que rejeitam data inválida.\n\n" +
          "**⚠️ `search` provavelmente está quebrado neste banco.** O filtro usa " +
          "`{ contains: q.search, mode: 'insensitive' }` — e a própria documentação " +
          "oficial do Prisma diz que `mode: 'insensitive'` **não está disponível** na " +
          "API gerada para o provider MySQL (só existe para PostgreSQL/MongoDB; " +
          "MySQL já é case-insensitive por padrão e por isso o Prisma nem expõe essa " +
          "opção pra esse provider). Como o `datasource` deste projeto é `mysql` " +
          "(`prisma/schema.prisma`), o esperado é que enviar `?search=algo` jogue uma " +
          "exceção de validação do Prisma em runtime — capturada pelo `catch` genérico " +
          "e devolvida como `500` com a mensagem fixa de baixo (não a mensagem real do " +
          "erro, então o cliente não vê pista nenhuma do motivo). **Não consegui " +
          "confirmar isso rodando a query de verdade neste ambiente (o engine do " +
          "Prisma não baixa aqui por causa do proxy de rede do sandbox) — recomendo " +
          "testar manualmente `GET /notifications?search=teste` antes de confiar nesta " +
          "observação, mas, pela documentação oficial do Prisma, é o comportamento " +
          "esperado.**\n\n" +
          "**Paginação sem `pages`:** a resposta traz `total`/`page`/`pageSize`/`items`, " +
          "mas — diferente de `GET /usuarios/` — **não calcula `pages`**; o cliente " +
          "precisa fazer `Math.ceil(total / pageSize)` por conta própria.\n\n" +
          "**`orderBy` só aceita um valor** (`\"criadoEm\"`, único item do enum) — não é " +
          "uma escolha real hoje, só existe a ordenação por data. `orderDir` " +
          "(`asc`/`desc`) esse sim tem efeito.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              default: 50,
              description: "Limite bem mais alto que o de `GET /usuarios/` (que é 100).",
            },
            apenasNaoLidas: {
              type: "string",
              default: "false",
              description:
                "Ver alerta acima sobre `z.coerce.boolean()` — qualquer valor não vazio " +
                "(inclusive a string `\"false\"`) é tratado como `true`.",
            },
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
            canal: { type: "string", enum: ["IN_APP", "EMAIL", "PUSH"] },
            criadoDe: {
              type: "string",
              description: "Data ISO (limite inferior de `criadoEm`). Valor inválido é ignorado, sem erro — ver nota acima.",
              example: "2026-09-01T00:00:00.000Z",
            },
            criadoAte: {
              type: "string",
              description: "Data ISO (limite superior de `criadoEm`). Mesma observação de `criadoDe`.",
            },
            search: {
              type: "string",
              description:
                "Busca em `titulo`/`mensagem`. ⚠️ Ver alerta acima — provavelmente " +
                "causa 500 neste banco (MySQL).",
            },
            orderBy: {
              type: "string",
              enum: ["criadoEm"],
              default: "criadoEm",
            },
            orderDir: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
        },
        response: {
          200: {
            description: "Página de notificações do usuário (sempre 200, mesmo com `items: []`).",
            type: "object",
            required: ["total", "page", "pageSize", "items"],
            properties: {
              total: { type: "integer", example: 42 },
              page: { type: "integer", example: 1 },
              pageSize: { type: "integer", example: 50 },
              items: { type: "array", items: NotificacaoSchema },
            },
          },
          400: {
            description:
              "Querystring fora do schema — ex.: `pageSize` > 1000, `tipo`/`canal`/" +
              "`orderBy`/`orderDir` fora do enum.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao listar. **Mensagem fixa** — diferente de quase todos " +
              "os outros endpoints documentados até agora (users e o resto de " +
              "notifications), este `catch` não devolve `errMsg(e)`, sempre a mesma " +
              "string, então o `error` real fica só no log do servidor. Ver alerta " +
              "sobre `search` acima — é a causa mais provável de um 500 aqui.",
            type: "object",
            properties: {
              error: { type: "string", example: "Erro interno ao listar notificações" },
            },
          },
        },
      },
    },
    list,
  );

  // POST /notifications/read-all
  app.post(
    "/read-all",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Marcar todas as notificações não lidas como lidas",
        description:
          "Marca como lidas (`lidaEm = agora`) todas as notificações do usuário " +
          "autenticado que casarem com o filtro — **não é literalmente \"todas\"**: o " +
          "`where` de `markAllAsRead` (`notifications.service.ts`) é " +
          "`{ usuarioId, lidaEm: null, arquivadaEm: null }`.\n\n" +
          "**⚠️ Notificação arquivada-e-não-lida NÃO é marcada como lida por este " +
          "endpoint**, mesmo estando não lida — o filtro exige `arquivadaEm: null`. " +
          "Pra ler uma notificação arquivada, só chamando " +
          "`PATCH /notifications/{id}/lida` nela individualmente (que, como " +
          "documentado nesse endpoint, também a desarquiva).\n\n" +
          "**⚠️ Não limpa `erroEntrega`** — diferente de `PATCH .../lida`, que zera " +
          "esse campo quando marca uma notificação específica como lida. Aqui, " +
          "notificações marcadas em massa mantêm qualquer erro de entrega que já " +
          "tinham.\n\n" +
          "**Sem parâmetros** — não tem como escopar por `tipo`, `canal` ou intervalo " +
          "de datas; é tudo (não arquivado e não lido) ou nada. Sem corpo na " +
          "requisição também (o endpoint ignora qualquer corpo enviado).\n\n" +
          "**Sempre `200`, mesmo sem nada pra atualizar** — zero notificações não " +
          "lidas/não arquivadas resulta em `{ \"count\": 0 }`, não em erro.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description:
              "Quantidade de notificações efetivamente atualizadas (pode ser `0`).",
            type: "object",
            required: ["count"],
            properties: {
              count: {
                type: "integer",
                description: "Quantas notificações (não lidas e não arquivadas) foram marcadas como lidas agora.",
                example: 7,
              },
            },
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          429: RateLimit429Response,
          500: {
            description: "Erro inesperado. `error` é a mensagem crua da exceção (via `errMsg()`).",
            type: "object",
            properties: {
              error: { type: "string", example: "Connection lost: The server closed the connection." },
            },
          },
        },
      },
    },
    readAll,
  );

  // POST /notifications/test
  app.post(
    "/test",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Criar uma notificação de teste para o próprio usuário",
        description:
          "Cria uma notificação fixa, só pra verificar se o pipeline de notificação " +
          "(criação → aparecer em `GET /notifications/` → UI) está funcionando. " +
          "Qualquer papel autenticado pode chamar — não é restrito a " +
          "`ADMINISTRADOR`/equipe.\n\n" +
          "**O conteúdo é sempre o mesmo, não é configurável.** " +
          "`createTestNotification` (`notifications.service.ts`) não recebe nenhum " +
          "parâmetro além do `userId` — `titulo`, `mensagem`, `tipo` (`SISTEMA`), " +
          "`canal` (`IN_APP`) e `meta` (`{ url: \"/dashboard\" }`) são todos fixos no " +
          "código. **O corpo da requisição é totalmente ignorado** (não existe " +
          "validação de `body` aqui — nenhum campo enviado tem efeito nenhum). Duas " +
          "chamadas seguidas criam dois registros idênticos, diferindo só em `id` e " +
          "`criadoEm`. Não dá pra usar este endpoint pra testar outros tipos/canais de " +
          "notificação.\n\n" +
          "**⚠️ É o único dos 6 endpoints deste arquivo cujo corpo de resposta tem o " +
          "campo `entregueEm`.** Diferente de `listNotifications` (que usa um `select` " +
          "com 15 campos — ver schema `Notificacao` usado em `GET /notifications/`), " +
          "aqui o `prisma.notificacao.create(...)` é chamado **sem `select`**, " +
          "então a Prisma devolve a linha inteira — todos os 16 campos escalares do " +
          "model, incluindo `entregueEm` (sempre `null`, já que nada entrega essa " +
          "notificação de teste de verdade).\n\n" +
          "**Status da resposta é `200`, não `201`** — mesmo criando um registro novo " +
          "no banco, o controller não chama `res.code(201)` antes de `send()`; " +
          "diferente de `POST /usuarios/`, que usa `201` corretamente para criação.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description:
              "Notificação de teste criada (conteúdo sempre igual, exceto `id`/`criadoEm`).",
            type: "object",
            title: "NotificacaoDeTeste",
            properties: {
              ...NotificacaoSchema.properties,
              entregueEm: {
                type: "string",
                format: "date-time",
                nullable: true,
                description: "Sempre `null` aqui — este campo só aparece neste endpoint (ver nota acima).",
              },
            },
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          429: RateLimit429Response,
          500: {
            description: "Erro inesperado. `error` é a mensagem crua da exceção (via `errMsg()`).",
            type: "object",
            properties: {
              error: { type: "string", example: "Connection lost: The server closed the connection." },
            },
          },
        },
      },
    },
    createTest,
  );

  // PATCH /notifications/:id/lida
  app.patch(
    "/:id/lida",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Marcar uma notificação como lida",
        description:
          "Marca a notificação como lida (`lidaEm = agora`). Só funciona na própria " +
          "notificação do usuário autenticado — qualquer papel pode chamar (sem " +
          "`app.authorize`, só o `app.authenticate` global do plugin).\n\n" +
          "**⚠️ Também desarquiva e limpa o erro de entrega — efeito colateral não " +
          "óbvio pelo nome do endpoint.** `markAsRead` " +
          "(`notifications.service.ts`) faz os 3 em uma tacada só: `lidaEm = agora`, " +
          "`arquivadaEm = null` e `erroEntrega = null`. Ou seja, marcar como lida uma " +
          "notificação arquivada **tira ela do arquivo**; e se ela tinha uma falha de " +
          "entrega registrada (`erroEntrega`), essa marca some também. Não há como " +
          "marcar como lida mantendo arquivada, nem como preservar o histórico de erro " +
          "de entrega.\n\n" +
          "**Escopo por IDOR, de propósito:** o `update` usa `updateMany({ where: " +
          "{ id, usuarioId } })`, não um `update` simples por `id`. Isso significa que " +
          "`id` de uma notificação de **outro usuário** dá o mesmo `404` que um `id` " +
          "inexistente — o endpoint nunca revela se aquele `id` existe e pertence a " +
          "outra pessoa (evita um IDOR de enumeração/escrita, segundo o comentário do " +
          "próprio código-fonte).\n\n" +
          "**Resposta é `204` (sem corpo)** — não devolve a notificação atualizada; se " +
          "precisar do estado novo, é preciso um `GET /notifications/` depois.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmk9876543210987654321098" },
          },
        },
        response: {
          204: { description: "Marcada como lida (e desarquivada, e sem erro de entrega). Sem corpo." },
          400: {
            description:
              "`id` fora do schema (string vazia) — na prática inatingível por esta " +
              "rota (o Fastify não casa `/:id/lida` com segmento vazio), mesma " +
              "observação já feita para os endpoints por `id` de `/usuarios`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          404: {
            description:
              "Nenhuma notificação com esse `id` pertencendo ao usuário autenticado " +
              "(inclui o caso do `id` existir, mas ser de outro usuário — ver nota " +
              "acima). ⚠️ Mensagem com erro de concordância — ver descrição do campo.",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: EXAMPLE_NOTIFICATION_NOT_FOUND,
                description:
                  "Texto exatamente como a API devolve, incluindo o erro de " +
                  "concordância de gênero (\"não encontrado\", não \"encontrada\").",
              },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado. `error` é a mensagem crua da exceção (via `errMsg()`) " +
              "— diferente de `GET /notifications/`, que usa mensagem fixa.",
            type: "object",
            properties: {
              error: { type: "string", example: "Connection lost: The server closed the connection." },
            },
          },
        },
      },
    },
    readOne,
  );

  // POST /notifications/:id/archive
  app.post(
    "/:id/archive",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Arquivar uma notificação",
        description:
          "Arquiva a notificação (`arquivadaEm = agora`). Só na própria notificação do " +
          "usuário autenticado; qualquer papel pode chamar.\n\n" +
          "**Não mexe em `lidaEm`** — ao contrário de `PATCH /notifications/{id}/lida` " +
          "(que desarquiva como efeito colateral), arquivar **não marca como lida**. " +
          "Dá pra arquivar uma notificação não lida, e ela continua não lida — só que " +
          "agora, por causa do filtro de `GET /notifications/` " +
          "(`apenasNaoLidas=true` exige `lidaEm: null AND arquivadaEm: null`), ela " +
          "some da visão \"só não lidas\" mesmo sem nunca ter sido lida.\n\n" +
          "**Também não limpa `erroEntrega`** — diferente de `PATCH .../lida`, que " +
          "zera esse campo. Uma notificação arquivada pode continuar com um erro de " +
          "entrega registrado.\n\n" +
          "**Mesma proteção por IDOR de `PATCH .../lida`:** `updateMany({ where: " +
          "{ id, usuarioId } })` — `id` de notificação de outro usuário dá o mesmo " +
          "`404` de um `id` inexistente.\n\n" +
          "**Idempotente:** arquivar de novo uma notificação já arquivada não dá erro, " +
          "só atualiza `arquivadaEm` para o instante atual.\n\n" +
          "**Resposta é `204` (sem corpo).**",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmk9876543210987654321098" },
          },
        },
        response: {
          204: { description: "Arquivada. `lidaEm` e `erroEntrega` não são alterados. Sem corpo." },
          400: {
            description:
              "`id` fora do schema (string vazia) — na prática inatingível por esta " +
              "rota, mesma observação de `PATCH .../lida`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          404: {
            description:
              "Nenhuma notificação com esse `id` pertencendo ao usuário autenticado " +
              "(inclui `id` de outro usuário). ⚠️ Mesma mensagem com erro de " +
              "concordância de `PATCH .../lida`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_NOTIFICATION_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description: "Erro inesperado. `error` é a mensagem crua da exceção (via `errMsg()`).",
            type: "object",
            properties: {
              error: { type: "string", example: "Connection lost: The server closed the connection." },
            },
          },
        },
      },
    },
    archive,
  );

  // POST /notifications/:id/unarchive
  app.post(
    "/:id/unarchive",
    {
      schema: {
        tags: ["Notificacoes"],
        summary: "Desarquivar uma notificação",
        description:
          "Desarquiva a notificação (`arquivadaEm = null`). Espelho exato do " +
          "`POST /notifications/{id}/archive` — mesma regra, ao contrário: só mexe em " +
          "`arquivadaEm`, não toca `lidaEm` nem `erroEntrega`. Desarquivar uma " +
          "notificação já lida não a torna não lida; desarquivar uma com erro de " +
          "entrega registrado mantém esse erro.\n\n" +
          "**Idempotente, inclusive num caso trivial:** chamar numa notificação que " +
          "**nunca** foi arquivada não dá erro — o `updateMany` casa por `id`+" +
          "`usuarioId` (não exige `arquivadaEm` não nulo antes), então só reescreve " +
          "`arquivadaEm: null` sobre um valor que já era `null`. Não há como saber, " +
          "pela resposta, se a notificação estava realmente arquivada antes.\n\n" +
          "**Mesma proteção por IDOR** dos outros 2 endpoints por `id` " +
          "(`updateMany({ where: { id, usuarioId } })`).\n\n" +
          "**Resposta é `204` (sem corpo).**",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmk9876543210987654321098" },
          },
        },
        response: {
          204: { description: "Desarquivada (ou já não estava arquivada — ver nota acima). `lidaEm` e `erroEntrega` não mudam. Sem corpo." },
          400: {
            description:
              "`id` fora do schema (string vazia) — na prática inatingível por esta " +
              "rota, mesma observação dos outros 2 endpoints por `id`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token ausente/inválido, ou (caso residual) token válido sem `sub`.",
            oneOf: [UnauthorizedErrorSchema, NotAuthenticatedErrorSchema],
          },
          404: {
            description:
              "Nenhuma notificação com esse `id` pertencendo ao usuário autenticado " +
              "(inclui `id` de outro usuário). ⚠️ Mesma mensagem com erro de " +
              "concordância dos outros 2 endpoints por `id`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_NOTIFICATION_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description: "Erro inesperado. `error` é a mensagem crua da exceção (via `errMsg()`).",
            type: "object",
            properties: {
              error: { type: "string", example: "Connection lost: The server closed the connection." },
            },
          },
        },
      },
    },
    unarchive,
  );
}
