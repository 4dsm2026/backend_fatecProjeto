import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema, STAFF_ROLES } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { create, eligibility, getOne, list, respond, summary, transition } from "./matricula.controller";
import { MAX_TRANCAMENTOS, MOTIVOS, STATUS_VALUES, TIPO_VALUES } from "./matricula.rules";

/*
 * Trancamento e cancelamento de matrícula — BETA.
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

const STATUS_ENUM = [...STATUS_VALUES];
const TIPO_ENUM = [...TIPO_VALUES];

const SolicitacaoSchema = {
  type: "object",
  required: ["id", "usuarioId", "tipo", "status", "semestre", "motivo", "_links"],
  properties: {
    id: { type: "string" },
    usuarioId: { type: "string" },
    tipo: { type: "string", enum: TIPO_ENUM },
    status: { type: "string", enum: STATUS_ENUM },
    semestre: { type: "string" },
    motivo: { type: "string", enum: [...MOTIVOS] },
    justificativa: { type: "string", nullable: true },
    curso: { type: "string", description: "Curso do aluno na hora do pedido" },
    orientacaoFatec: { type: "string", nullable: true },
    decididoEm: { type: "string", format: "date-time", nullable: true },
    alertas: { type: "array", items: { type: "string" }, description: "Só para a equipe: o que considerar antes de decidir" },
    criadoEm: { type: "string", format: "date-time" },
    usuario: { type: "object", additionalProperties: true },
    historico: { type: "array", items: { type: "object", additionalProperties: true } },
    _links: {
      ...HalLinksSchema,
      description: "`transition` (POST …/status, `name` = destino); `respond` (aluno, quando há pendência); `student` (equipe).",
    },
  },
} as const;

const CollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: { type: "object", properties: { "enrollment-requests": { type: "array", items: SolicitacaoSchema } } },
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
  404: problemResponse("Solicitação não encontrada (ou de outro aluno)."),
  409: problemResponse("Situação não permite a ação."),
  429: problemResponse("Limite de requisições excedido."),
  500: problemResponse("Erro inesperado."),
} as const;

const TAG = "Enrollment requests (beta)";

export async function matriculaRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/",
    {
      schema: {
        tags: [TAG],
        summary: "Pedir trancamento ou cancelamento (aluno)",
        description:
          `Um pedido em andamento por vez. Trancamento: até ${MAX_TRANCAMENTOS} deferidos, e não para matrícula já trancada. ` +
          "Cancelamento é definitivo e exige `cienteDefinitivo: true`. `motivo` OUTRO exige `justificativa`.",
        security,
        body: {
          type: "object",
          required: ["tipo", "motivo"],
          properties: {
            tipo: { type: "string", enum: TIPO_ENUM },
            semestre: { type: "string", description: "Padrão: semestre letivo atual" },
            motivo: { type: "string", enum: [...MOTIVOS] },
            justificativa: { type: "string", maxLength: 2000, nullable: true },
            cienteDefinitivo: { type: "boolean" },
          },
        },
        response: { 201: { description: "Pedido criado.", ...SolicitacaoSchema }, ...commonProblems },
      },
    },
    create,
  );

  app.get(
    "/",
    {
      schema: {
        tags: [TAG],
        summary: "Listar pedidos",
        description: "Aluno: os próprios. Equipe: todos, com filtros (`usuarioId` para a ficha do aluno).",
        security,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            status: { type: "string", description: "Um ou mais, separados por vírgula" },
            tipo: { type: "string", enum: TIPO_ENUM },
            semestre: { type: "string" },
            curso: { type: "string" },
            usuarioId: { type: "string" },
            abertos: { type: "boolean" },
            search: { type: "string", description: "Nome ou RA" },
          },
        },
        response: { 200: CollectionSchema, ...commonProblems },
      },
    },
    list,
  );

  app.get(
    "/eligibility",
    {
      schema: {
        tags: [TAG],
        summary: "O que o aluno pode pedir agora (aluno)",
        description: "Situação acadêmica, trancamentos já usados, pedido em andamento e o motivo de cada bloqueio.",
        security,
        response: { 200: { type: "object", additionalProperties: true }, ...commonProblems },
      },
    },
    eligibility,
  );

  app.get(
    "/summary",
    {
      preHandler: app.authorize([...STAFF_ROLES]),
      schema: {
        tags: [TAG],
        summary: "Resumo para a equipe",
        description: "Fila por status e, no semestre, deferidos por motivo e por curso.",
        security,
        querystring: { type: "object", properties: { semestre: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true }, ...commonProblems },
      },
    },
    summary,
  );

  app.get(
    "/:id",
    { schema: { tags: [TAG], summary: "Consultar pedido, com histórico", security, params: IdParams, response: { 200: SolicitacaoSchema, ...commonProblems } } },
    getOne,
  );

  app.post(
    "/:id/replies",
    {
      schema: {
        tags: [TAG],
        summary: "Responder pendência (aluno)",
        description: "Só em PENDENTE_ALUNO. Atualiza a justificativa e devolve para EM_ANALISE.",
        security,
        params: IdParams,
        body: { type: "object", required: ["justificativa"], properties: { justificativa: { type: "string", maxLength: 2000 } } },
        response: { 200: SolicitacaoSchema, ...commonProblems },
      },
    },
    respond,
  );

  app.post(
    "/:id/status",
    {
      schema: {
        tags: [TAG],
        summary: "Mudar o status",
        description:
          "Equipe: EM_ANALISE, PENDENTE_ALUNO e INDEFERIDO (estes dois com `comentario`), DEFERIDO. " +
          "Deferir atualiza a situação acadêmica do aluno (Trancada ou Cancelada). Aluno: CANCELADO (desistir).",
        security,
        params: IdParams,
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: STATUS_ENUM }, comentario: { type: "string", maxLength: 1000 } },
        },
        response: { 200: SolicitacaoSchema, ...commonProblems },
      },
    },
    transition,
  );
}
