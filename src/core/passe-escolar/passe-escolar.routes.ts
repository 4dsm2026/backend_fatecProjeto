import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema, STAFF_ROLES } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { create, exportCsv, getOne, list, transition, update } from "./passe-escolar.controller";
import { STATUS_PASSE_VALUES } from "./passe-escolar.rules";

/*
 * Passe Escolar (EMTU/ARTESP) — BETA.
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

const STATUS_ENUM = [...STATUS_PASSE_VALUES];

const DadosProperties = {
  nomeCompleto: { type: "string", minLength: 3, maxLength: 120 },
  rg: { type: "string", minLength: 5, maxLength: 20 },
  cpf: { type: "string", description: "11 dígitos (pontuação é ignorada); dígitos verificadores conferidos" },
  cep: { type: "string", description: "8 dígitos (hífen é ignorado)" },
  municipioResidencia: { type: "string", maxLength: 80 },
  curso: { type: "string", maxLength: 120 },
  periodo: { type: "string", maxLength: 40, description: "Manhã, Tarde, Noite…" },
  mesConclusao: { type: "integer", minimum: 1, maximum: 12 },
  anoConclusao: { type: "integer" },
  declaraBaixaRenda: { type: "boolean", description: "Obrigatório `true` para PASSE_LIVRE" },
  observacaoAluno: { type: "string", maxLength: 500, nullable: true },
} as const;

const PasseSchema = {
  type: "object",
  required: ["id", "usuarioId", "anoReferencia", "tipo", "modalidade", "status", "_links"],
  properties: {
    id: { type: "string" },
    usuarioId: { type: "string" },
    anoReferencia: { type: "integer" },
    tipo: { type: "string", enum: ["NOVO", "REVALIDACAO"] },
    modalidade: { type: "string", enum: ["PASSE_LIVRE", "MEIA_TARIFA"] },
    status: { type: "string", enum: STATUS_ENUM },
    ...DadosProperties,
    orientacaoFatec: { type: "string", nullable: true },
    cadastradoPortalEm: { type: "string", format: "date-time", nullable: true },
    protocoloEmtu: { type: "string", nullable: true },
    encerradoEm: { type: "string", format: "date-time", nullable: true },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
    usuario: { type: "object", additionalProperties: true },
    cadastradoPor: { type: "object", nullable: true, additionalProperties: true },
    historico: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          de: { type: "string", enum: STATUS_ENUM, nullable: true },
          para: { type: "string", enum: STATUS_ENUM },
          comentario: { type: "string", nullable: true },
          criadoEm: { type: "string", format: "date-time" },
          autor: { type: "object", nullable: true, additionalProperties: true },
        },
      },
    },
    _links: {
      ...HalLinksSchema,
      description:
        "`update` (PATCH) só enquanto o aluno pode corrigir; `transition` (POST …/status) um por etapa permitida, com `name` = status de destino.",
    },
  },
} as const;

const CollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: {
      type: "object",
      required: ["school-passes"],
      properties: { "school-passes": { type: "array", items: PasseSchema } },
    },
    page: PageInfoSchema,
    _links: HalLinksSchema,
  },
} as const;

const IdParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

const security = [{ bearerAuth: [] }];
const commonProblems = {
  400: problemResponse("Dados inválidos."),
  401: problemResponse("Autenticação obrigatória."),
  403: problemResponse("Papel sem permissão para a ação."),
  404: problemResponse("Pedido não encontrado (ou de outro aluno)."),
  409: problemResponse("Etapa não permite a ação."),
  429: problemResponse("Limite de requisições excedido."),
  500: problemResponse("Erro inesperado."),
} as const;

const TAG = "School passes (beta)";

export async function passeEscolarRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/",
    {
      schema: {
        tags: [TAG],
        summary: "Pedir o cadastro do Passe Escolar à Fatec",
        description:
          "O aluno informa os dados que a Fatec lança no Portal de Relacionamento da ARTESP/EMTU. " +
          "Só um pedido em andamento por ano (409 se já houver).",
        security,
        body: {
          type: "object",
          required: ["modalidade", "nomeCompleto", "rg", "cpf", "cep", "municipioResidencia", "curso", "periodo", "mesConclusao", "anoConclusao"],
          properties: {
            anoReferencia: { type: "integer", description: "Padrão: ano atual" },
            tipo: { type: "string", enum: ["NOVO", "REVALIDACAO"], default: "NOVO" },
            modalidade: { type: "string", enum: ["PASSE_LIVRE", "MEIA_TARIFA"] },
            ...DadosProperties,
          },
        },
        response: {
          201: { description: "Pedido criado.", headers: { Location: { type: "string" } }, ...PasseSchema },
          ...commonProblems,
        },
      },
    },
    create,
  );

  app.get(
    "/",
    {
      schema: {
        tags: [TAG],
        summary: "Listar pedidos visíveis ao usuário",
        description: "Aluno: só os próprios. Equipe: todos, com filtros. `search` (equipe) procura por nome, RA ou CPF.",
        security,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            status: { type: "string", description: "Um ou mais, separados por vírgula", enum: STATUS_ENUM },
            ano: { type: "integer" },
            ativos: { type: "boolean", description: "Só pedidos em andamento" },
            search: { type: "string", maxLength: 80 },
          },
        },
        response: { 200: CollectionSchema, ...commonProblems },
      },
    },
    list,
  );

  app.get(
    "/export",
    {
      preHandler: app.authorize([...STAFF_ROLES]),
      schema: {
        tags: [TAG],
        summary: "Exportar pedidos em CSV (equipe)",
        description: "Colunas na ordem que o Portal de Relacionamento pede. Separador `;`, com BOM. Máximo de 5000 linhas.",
        security,
        querystring: {
          type: "object",
          properties: {
            ano: { type: "integer" },
            status: { type: "string", enum: STATUS_ENUM },
          },
        },
        response: {
          200: { description: "Arquivo CSV.", content: { "text/csv": { schema: { type: "string" } } } },
          ...commonProblems,
        },
      },
    },
    exportCsv,
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: [TAG],
        summary: "Consultar pedido, com histórico de etapas",
        security,
        params: IdParams,
        response: { 200: PasseSchema, ...commonProblems },
      },
    },
    getOne,
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: [TAG],
        summary: "Corrigir dados (aluno)",
        description:
          "Só enquanto o pedido está SOLICITADO ou PENDENTE_ALUNO. Se estava pendente, volta para SOLICITADO.",
        security,
        params: IdParams,
        body: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["NOVO", "REVALIDACAO"] },
            modalidade: { type: "string", enum: ["PASSE_LIVRE", "MEIA_TARIFA"] },
            ...DadosProperties,
          },
        },
        response: { 200: PasseSchema, ...commonProblems },
      },
    },
    update,
  );

  app.post(
    "/:id/status",
    {
      schema: {
        tags: [TAG],
        summary: "Mudar a etapa do pedido",
        description:
          "Equipe: CADASTRADO_PORTAL, PENDENTE_ALUNO (comentário obrigatório), INDEFERIDO (comentário obrigatório), " +
          "CONCLUIDO, CANCELADO. Aluno: REQUISITADO_EMTU (opcional `protocoloEmtu`), CONCLUIDO, INDEFERIDO, CANCELADO. " +
          "As transições válidas vêm nos links `transition` do pedido.",
        security,
        params: IdParams,
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: STATUS_ENUM },
            comentario: { type: "string", maxLength: 1000 },
            protocoloEmtu: { type: "string", maxLength: 40 },
          },
        },
        response: { 200: PasseSchema, ...commonProblems },
      },
    },
    transition,
  );
}
