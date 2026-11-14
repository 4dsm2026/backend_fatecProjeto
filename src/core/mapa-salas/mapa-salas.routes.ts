import type { FastifyInstance } from "fastify";
import { HalLinksSchema, PageInfoSchema, STAFF_ROLES } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { commonProblemResponses } from "../../utils/openapi-problem";
import { current, currentFile, getSource, putSource, syncSource, testSource, upload, versionFile, versions } from "./mapa-salas.controller";

/*
 * Mapa de salas — BETA.
 * O mapa é o PDF publicado pela Fatec no site institucional. O administrador
 * configura de onde buscá-lo (URL da página + XPath) ou envia o PDF à mão.
 * Os schemas abaixo são só para o Swagger (a validação real é Zod, no controller).
 */

const VersaoSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    origem: { type: "string", enum: ["AUTOMATICA", "MANUAL"] },
    nomeArquivo: { type: "string" },
    tamanhoBytes: { type: "integer" },
    checksumSha256: { type: "string" },
    urlOrigem: { type: "string", nullable: true },
    publicadoEm: { type: "string", format: "date-time" },
    publicadoPor: { type: "object", nullable: true, additionalProperties: true },
    _links: HalLinksSchema,
  },
} as const;

const FonteSchema = {
  type: "object",
  properties: {
    url: { type: "string", nullable: true, description: "Página do site institucional (https)" },
    xpath: { type: "string", nullable: true, description: "XPath do PDF na página, ex.: //iframe[contains(@class,'embed-pdf-viewer')]/@src" },
    atualizacaoAutomatica: { type: "boolean", description: "Conferir a página todo dia às 06:00" },
    ultimaVerificacaoEm: { type: "string", format: "date-time", nullable: true },
    ultimoResultado: { type: "string", nullable: true },
    ultimoErro: { type: "string", nullable: true },
    _links: HalLinksSchema,
  },
} as const;

const pdf = { 200: { description: "PDF do mapa.", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } } };
const security = [{ bearerAuth: [] }];
const commonProblems = commonProblemResponses("Mapa ou versão não encontrado.", "Fonte não configurada.");
const TAG = "Room maps (beta)";
const ADMIN = ["ADMINISTRADOR"] as const;

export async function mapaSalasRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);

  app.get("/current", {
    schema: {
      tags: [TAG],
      summary: "Mapa de salas atual",
      description: "Qualquer usuário logado. `atual` é null enquanto nenhum mapa foi publicado.",
      security,
      response: { 200: { type: "object", properties: { atual: { ...VersaoSchema, nullable: true }, _links: HalLinksSchema } }, ...commonProblems },
    },
  }, current);

  app.get("/current/file", {
    schema: { tags: [TAG], summary: "PDF do mapa atual", description: "`?download=1` para baixar em vez de abrir.", security, response: { ...pdf, ...commonProblems } },
  }, currentFile);

  app.get("/versions", {
    preHandler: app.authorize([...STAFF_ROLES]),
    schema: {
      tags: [TAG],
      summary: "Histórico de versões (equipe)",
      security,
      querystring: { type: "object", properties: { page: { type: "integer", minimum: 0 }, size: { type: "integer", minimum: 1, maximum: 100 } } },
      response: {
        200: { type: "object", properties: { _embedded: { type: "object", properties: { "room-map-versions": { type: "array", items: VersaoSchema } } }, page: PageInfoSchema, _links: HalLinksSchema } },
        ...commonProblems,
      },
    },
  }, versions);

  app.get("/versions/:id/file", {
    preHandler: app.authorize([...STAFF_ROLES]),
    schema: { tags: [TAG], summary: "PDF de uma versão (equipe)", security, params: { type: "object", properties: { id: { type: "string" } } }, response: { ...pdf, ...commonProblems } },
  }, versionFile);

  app.post("/versions", {
    preHandler: app.authorize([...ADMIN]),
    schema: {
      tags: [TAG],
      summary: "Enviar o PDF manualmente (admin)",
      description: "multipart/form-data com o campo `file` (PDF, até 10 MB). Se for igual ao atual, responde 200 com `nova: false`.",
      security,
      consumes: ["multipart/form-data"],
      response: { 201: { type: "object", additionalProperties: true }, 200: { type: "object", additionalProperties: true }, ...commonProblems },
    },
  }, upload);

  app.get("/source", {
    preHandler: app.authorize([...ADMIN]),
    schema: { tags: [TAG], summary: "Fonte automática (admin)", security, response: { 200: FonteSchema, ...commonProblems } },
  }, getSource);

  app.put("/source", {
    preHandler: app.authorize([...ADMIN]),
    schema: {
      tags: [TAG],
      summary: "Configurar a fonte automática (admin)",
      description: "Só https; endereços internos são recusados.",
      security,
      body: { type: "object", properties: { url: { type: "string", nullable: true }, xpath: { type: "string", nullable: true }, atualizacaoAutomatica: { type: "boolean" } } },
      response: { 200: FonteSchema, ...commonProblems },
    },
  }, putSource);

  app.post("/source/test", {
    preHandler: app.authorize([...ADMIN]),
    schema: {
      tags: [TAG],
      summary: "Testar URL e XPath sem publicar (admin)",
      security,
      body: { type: "object", required: ["url", "xpath"], properties: { url: { type: "string" }, xpath: { type: "string" } } },
      response: {
        200: { type: "object", properties: { urlPdf: { type: "string" }, nomeArquivo: { type: "string" }, tamanhoBytes: { type: "integer" }, igualAoAtual: { type: "boolean" } } },
        ...commonProblems,
      },
    },
  }, testSource);

  app.post("/source/sync", {
    preHandler: app.authorize([...ADMIN]),
    schema: {
      tags: [TAG],
      summary: "Atualizar agora a partir da fonte (admin)",
      description: "Busca o PDF e publica uma versão nova só se ele mudou.",
      security,
      response: { 200: { type: "object", additionalProperties: true }, ...commonProblems },
    },
  }, syncSource);
}
