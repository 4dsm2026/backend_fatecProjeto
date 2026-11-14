import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema, STAFF_ROLES } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { copy, courses, create, getOne, list, remove, respond, results, transition, update } from "./pesquisas.controller";
import { PESQUISA_MIN_RESPOSTAS, STATUS_PESQUISA_VALUES, TIPO_PERGUNTA_VALUES } from "./pesquisas.rules";

/*
 * Pesquisa institucional (CPA) — BETA.
 * Os schemas abaixo são só para o Swagger (a validação real é Zod, no controller).
 */

const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    errors: { type: "array", items: { type: "object" } },
  },
} as const;

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const STATUS_ENUM = [...STATUS_PESQUISA_VALUES];

const PerguntaSchema = {
  type: "object",
  required: ["texto", "tipo"],
  properties: {
    id: { type: "string" },
    ordem: { type: "integer" },
    secao: { type: "string", nullable: true, maxLength: 80 },
    texto: { type: "string", maxLength: 300 },
    tipo: { type: "string", enum: [...TIPO_PERGUNTA_VALUES], description: "ESCALA = 1 a 5 (0 = não sei); MULTIPLA = uma de `opcoes`; TEXTO = aberta" },
    opcoes: { type: "array", items: { type: "string" }, nullable: true },
    obrigatoria: { type: "boolean", default: true },
  },
} as const;

const CamposProperties = {
  titulo: { type: "string", minLength: 3, maxLength: 160 },
  descricao: { type: "string", nullable: true, maxLength: 2000 },
  semestre: { type: "string", pattern: "^\\d{4}-[12]$", description: 'Ex.: "2026-2"' },
  cursos: { type: "array", items: { type: "string" }, nullable: true, description: "Cursos (cursoNome) que respondem. null = todos." },
  fechaEm: { type: "string", format: "date-time", nullable: true, description: "Prazo para responder" },
  perguntas: { type: "array", items: PerguntaSchema, maxItems: 60 },
} as const;

const PesquisaSchema = {
  type: "object",
  required: ["id", "titulo", "semestre", "status", "_links"],
  properties: {
    id: { type: "string" },
    ...CamposProperties,
    status: { type: "string", enum: STATUS_ENUM },
    aceitaRespostas: { type: "boolean", description: "ABERTA e dentro do prazo" },
    totalRespostas: { type: "integer", description: "Só para a equipe" },
    totalPerguntas: { type: "integer" },
    respondida: { type: "boolean", description: "Só para o aluno" },
    abertaEm: { type: "string", format: "date-time", nullable: true },
    encerradaEm: { type: "string", format: "date-time", nullable: true },
    criadoEm: { type: "string", format: "date-time" },
    _links: {
      ...HalLinksSchema,
      description:
        "`update`/`delete` só em rascunho; `transition` (POST …/status, `name` = destino); `copy`; `results` (equipe); `respond` (aluno, se ainda pode responder).",
    },
  },
} as const;

const CollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: { type: "object", required: ["surveys"], properties: { surveys: { type: "array", items: PesquisaSchema } } },
    page: PageInfoSchema,
    _links: HalLinksSchema,
  },
} as const;

const IdParams = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

const security = [{ bearerAuth: [] }];
const commonProblems = {
  400: problemResponse("Dados inválidos."),
  401: problemResponse("Autenticação obrigatória."),
  403: problemResponse("Papel sem permissão para a ação."),
  404: problemResponse("Pesquisa não encontrada (ou fora do público do aluno)."),
  409: problemResponse("Estado não permite a ação."),
  429: problemResponse("Limite de requisições excedido."),
  500: problemResponse("Erro inesperado."),
} as const;

const TAG = "Surveys (beta)";
const ADMIN = ["ADMINISTRADOR"] as const;

export async function pesquisasRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/",
    {
      preHandler: app.authorize([...ADMIN]),
      schema: {
        tags: [TAG],
        summary: "Criar pesquisa (rascunho)",
        description: "Sem `perguntas`, começa pelo modelo da CPA (`modelo: true`, padrão) ou em branco (`modelo: false`).",
        security,
        body: {
          type: "object",
          required: ["titulo", "semestre"],
          properties: { ...CamposProperties, modelo: { type: "boolean", default: true } },
        },
        response: { 201: { description: "Pesquisa criada.", ...PesquisaSchema }, ...commonProblems },
      },
    },
    create,
  );

  app.get(
    "/",
    {
      schema: {
        tags: [TAG],
        summary: "Listar pesquisas",
        description: "Equipe: todas, com filtros. Aluno: só as abertas para o curso dele, com `respondida`.",
        security,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            semestre: { type: "string" },
            status: { type: "string", enum: STATUS_ENUM },
          },
        },
        response: { 200: CollectionSchema, ...commonProblems },
      },
    },
    list,
  );

  app.get(
    "/courses",
    {
      preHandler: app.authorize([...STAFF_ROLES]),
      schema: {
        tags: [TAG],
        summary: "Cursos com alunos ativos (equipe)",
        description: "Vem do cadastro dos alunos (`cursoNome`). Serve para escolher o público da pesquisa.",
        security,
        response: {
          200: {
            type: "object",
            properties: {
              cursos: { type: "array", items: { type: "object", properties: { curso: { type: "string" }, alunos: { type: "integer" } } } },
              _links: HalLinksSchema,
            },
          },
          ...commonProblems,
        },
      },
    },
    courses,
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: [TAG],
        summary: "Consultar pesquisa, com as perguntas",
        security,
        params: IdParams,
        response: { 200: PesquisaSchema, ...commonProblems },
      },
    },
    getOne,
  );

  app.patch(
    "/:id",
    {
      preHandler: app.authorize([...ADMIN]),
      schema: {
        tags: [TAG],
        summary: "Editar rascunho",
        description: "Só em RASCUNHO. `perguntas`, se enviado, substitui a lista inteira (a ordem é a do array).",
        security,
        params: IdParams,
        body: { type: "object", properties: CamposProperties },
        response: { 200: PesquisaSchema, ...commonProblems },
      },
    },
    update,
  );

  app.delete(
    "/:id",
    {
      preHandler: app.authorize([...ADMIN]),
      schema: {
        tags: [TAG],
        summary: "Excluir rascunho",
        security,
        params: IdParams,
        response: { 204: { description: "Excluída.", type: "null" }, ...commonProblems },
      },
    },
    remove,
  );

  app.post(
    "/:id/status",
    {
      preHandler: app.authorize([...ADMIN]),
      schema: {
        tags: [TAG],
        summary: "Abrir, encerrar ou reabrir",
        description:
          "RASCUNHO → ABERTA (avisa os alunos do público) → ENCERRADA → ABERTA (reabrir; limpa o prazo se já venceu).",
        security,
        params: IdParams,
        body: { type: "object", required: ["status"], properties: { status: { type: "string", enum: STATUS_ENUM } } },
        response: { 200: PesquisaSchema, ...commonProblems },
      },
    },
    transition,
  );

  app.post(
    "/:id/copies",
    {
      preHandler: app.authorize([...ADMIN]),
      schema: {
        tags: [TAG],
        summary: "Copiar para outro semestre",
        description: "Cria um rascunho com as mesmas perguntas e o mesmo público. É assim que a pesquisa se repete todo semestre.",
        security,
        params: IdParams,
        body: {
          type: "object",
          required: ["semestre"],
          properties: { semestre: { type: "string" }, titulo: { type: "string" } },
        },
        response: { 201: { description: "Cópia criada.", ...PesquisaSchema }, ...commonProblems },
      },
    },
    copy,
  );

  app.post(
    "/:id/responses",
    {
      schema: {
        tags: [TAG],
        summary: "Responder (aluno, anônimo)",
        description:
          "Uma resposta por aluno. O sistema registra QUE o aluno respondeu, mas guarda as respostas sem ligação com ele " +
          "(sem usuário, sem data/hora). `respostas` é `{ [perguntaId]: valor }`: ESCALA 1–5 (0 = não sei), MULTIPLA o texto da opção, TEXTO livre.",
        security,
        params: IdParams,
        body: {
          type: "object",
          required: ["respostas"],
          properties: { respostas: { type: "object", additionalProperties: true } },
        },
        response: {
          201: { description: "Resposta registrada.", type: "object", properties: { respondida: { type: "boolean" }, _links: HalLinksSchema } },
          ...commonProblems,
        },
      },
    },
    respond,
  );

  app.get(
    "/:id/results",
    {
      preHandler: app.authorize([...STAFF_ROLES]),
      schema: {
        tags: [TAG],
        summary: "Resultados agregados (equipe)",
        description:
          `Participação por curso e, por pergunta, média e distribuição (ESCALA), contagem (MULTIPLA) e textos (TEXTO). ` +
          `Com menos de ${PESQUISA_MIN_RESPOSTAS} respostas no recorte, vem \`suprimido: true\` e sem \`perguntas\`, para preservar o anonimato.`,
        security,
        params: IdParams,
        querystring: { type: "object", properties: { curso: { type: "string", description: "Recorte por curso" } } },
        response: { 200: { type: "object", additionalProperties: true }, ...commonProblems },
      },
    },
    results,
  );
}
