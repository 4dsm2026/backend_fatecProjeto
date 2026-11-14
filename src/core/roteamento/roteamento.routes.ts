import type { FastifyInstance } from "fastify";
import { HalLinksSchema } from "../../hateoas";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { commonProblemResponses } from "../../utils/openapi-problem";
import { createRule, deleteRule, getSectorRouting, listRules, preview, putSectorRouting, updateRule } from "./roteamento.controller";

/*
 * Roteamento de chamados (admin).
 * Regras: categoria e/ou serviço do catálogo → setor de destino (+ setor em cópia).
 * Hierarquia por setor: 1º nível e cópia recebem e-mail na chegada; o 2º nível recebe
 * quando o chamado passa do prazo (horas úteis) sem ninguém assumir.
 * Os schemas abaixo são só para o Swagger (a validação real é Zod, no controller).
 */

const SetorRef = { type: "object", nullable: true, properties: { id: { type: "string" }, nome: { type: "string" } } } as const;

const RegraSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    ordem: { type: "integer", description: "Menor vem primeiro no empate" },
    ativo: { type: "boolean" },
    categoriaChave: { type: "string", nullable: true, description: "Id da categoria do catálogo" },
    servicoChave: { type: "string", nullable: true, description: "Id do serviço do catálogo (vence a categoria)" },
    setorId: { type: "string" },
    setorCopiaId: { type: "string", nullable: true },
    setor: SetorRef,
    setorCopia: SetorRef,
    _links: HalLinksSchema,
  },
} as const;

const RegraBody = {
  type: "object",
  properties: {
    nome: { type: "string" },
    ordem: { type: "integer" },
    ativo: { type: "boolean" },
    categoriaChave: { type: "string", nullable: true },
    servicoChave: { type: "string", nullable: true },
    setorId: { type: "string" },
    setorCopiaId: { type: "string", nullable: true },
  },
} as const;

const ContatoSchema = {
  type: "object",
  properties: {
    nivel: { type: "string", enum: ["PRIMEIRO", "SEGUNDO", "COPIA"] },
    usuarioId: { type: "string", nullable: true, description: "Funcionário (recebe no sistema e por e-mail)" },
    email: { type: "string", nullable: true, description: "E-mail avulso (só recebe e-mail)" },
    nome: { type: "string", nullable: true },
  },
} as const;

const HierarquiaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    prazoEscalonamentoHoras: { type: "integer", nullable: true, description: "Horas úteis (seg–sex) até avisar o 2º nível; null = não escalona" },
    contatos: { type: "array", items: { ...ContatoSchema, properties: { ...ContatoSchema.properties, id: { type: "string" }, usuario: { type: "object", nullable: true, additionalProperties: true } } } },
    _links: HalLinksSchema,
  },
} as const;

const security = [{ bearerAuth: [] }];
const commonProblems = commonProblemResponses("Regra ou setor não encontrado.", "Conflito.");
const TAG = "Ticket routing";
const ADMIN = ["ADMINISTRADOR"] as const;
const idParam = { type: "object", properties: { id: { type: "string" } } } as const;

export async function roteamentoRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.authorize([...ADMIN]));

  app.get("/routing-rules", {
    schema: {
      tags: [TAG],
      summary: "Regras de roteamento",
      security,
      response: {
        200: { type: "object", properties: { total: { type: "integer" }, _embedded: { type: "object", properties: { "routing-rules": { type: "array", items: RegraSchema } } }, _links: HalLinksSchema } },
        ...commonProblems,
      },
    },
  }, listRules);

  app.post("/routing-rules", {
    schema: {
      tags: [TAG],
      summary: "Criar regra",
      description: "Informe a categoria, o serviço ou os dois. Regra com serviço vence a que tem só a categoria.",
      security,
      body: { ...RegraBody, required: ["nome", "setorId"] },
      response: { 201: RegraSchema, ...commonProblems },
    },
  }, createRule);

  app.patch("/routing-rules/:id", {
    schema: { tags: [TAG], summary: "Editar regra", security, params: idParam, body: RegraBody, response: { 200: RegraSchema, ...commonProblems } },
  }, updateRule);

  app.delete("/routing-rules/:id", {
    schema: { tags: [TAG], summary: "Excluir regra", security, params: idParam, response: { 204: { type: "null", description: "Excluída." }, ...commonProblems } },
  }, deleteRule);

  app.get("/sectors/:id/routing", {
    schema: { tags: [TAG], summary: "Hierarquia de e-mails do setor", security, params: idParam, response: { 200: HierarquiaSchema, ...commonProblems } },
  }, getSectorRouting);

  app.put("/sectors/:id/routing", {
    schema: {
      tags: [TAG],
      summary: "Salvar a hierarquia do setor",
      description: "Substitui todos os contatos do setor pelos enviados.",
      security,
      params: idParam,
      body: {
        type: "object",
        required: ["prazoEscalonamentoHoras", "contatos"],
        properties: { prazoEscalonamentoHoras: { type: "integer", nullable: true }, contatos: { type: "array", items: ContatoSchema } },
      },
      response: { 200: HierarquiaSchema, ...commonProblems },
    },
  }, putSectorRouting);

  app.post("/routing-preview", {
    schema: {
      tags: [TAG],
      summary: "Simular o roteamento",
      description: "Para onde iria um chamado deste serviço/categoria e quem receberia e-mail. Não cria nada.",
      security,
      body: { type: "object", properties: { servico: { type: "string", nullable: true }, categoria: { type: "string", nullable: true }, setorProvavel: { type: "string", nullable: true } } },
      response: { 200: { type: "object", additionalProperties: true }, ...commonProblems },
    },
  }, preview);
}
