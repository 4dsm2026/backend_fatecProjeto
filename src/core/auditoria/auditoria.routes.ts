import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuditoriaController } from "./auditoria.controller";
import { buildRouteValidator, zStringTrim } from "../../utils/zod-helpers";
import { z } from "zod";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

const controller = new AuditoriaController();

const ListarPorPeriodoSchema = z.object({
  inicio: zStringTrim.min(8),
  fim: zStringTrim.min(8),
});

const RegistrarSchema = z.object({
  acao: zStringTrim.min(2),
  alvo: zStringTrim.optional(),
  meta: z.any().optional(),
  feitoPorId: zStringTrim.optional(),
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
          path: { type: "string", example: "acao" },
          message: { type: "string", example: "Mínimo de 2 caracteres" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

const ForbiddenErrorSchema = {
  type: "object",
  title: "ErroSemPermissao",
  properties: {
    error: { type: "string", example: "Acesso negado" },
  },
} as const;

const AuditoriaSchema = {
  type: "object",
  title: "RegistroDeAuditoria",
  properties: {
    id: { type: "string", example: "cmj1234567890123456789012" },
    acao: { type: "string", example: "CHAMADO_FECHADO" },
    alvo: {
      type: "string",
      nullable: true,
      description: "ID do recurso afetado pela ação (ex.: um ticket). Pode ser nulo quando a ação não afeta um recurso específico.",
      example: "ticket-4521",
    },
    meta: {
      type: "object",
      nullable: true,
      additionalProperties: true,
      description: "Dados adicionais livres sobre a ação, em formato JSON.",
    },
    feitoPorId: { type: "string", nullable: true, example: "user-admin-88" },
    feitoEm: { type: "string", format: "date-time" },
    feitoPor: {
      type: "object",
      nullable: true,
      additionalProperties: true,
      description: "Dados do usuário que executou a ação (relação `feitoPor`, sempre incluída pelo service).",
    },
  },
} as const;

export default async function auditoriaRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  app.get(
    "/auditoria",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Listar todo o histórico de auditoria",
        description:
          "Retorna **todos** os registros de auditoria do sistema, sem paginação, " +
          "ordenados do mais recente para o mais antigo (`orderBy: feitoEm desc`). " +
          "Cada registro traz junto os dados do usuário que executou a ação " +
          "(`include: feitoPor`).\n\n" +
          "**Restrito a administradores** — exige token válido " +
          "(`app.authenticate`) E papel `ADMINISTRADOR` (`app.authorize`).",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: "Lista completa dos registros de auditoria.",
            type: "array",
            items: AuditoriaSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Usuário autenticado, mas sem papel ADMINISTRADOR.",
            ...ForbiddenErrorSchema,
          },
        },
      },
    },
    controller.listar
  );

  app.get(
    "/auditoria/usuario/:id",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Listar o histórico de auditoria de um usuário específico",
        description:
          "Retorna todos os registros de auditoria em que `feitoPorId` é igual " +
          "ao `id` informado na URL, ordenados do mais recente para o mais " +
          "antigo. Não há checagem se o `id` corresponde a um usuário " +
          "existente — um ID inexistente simplesmente resulta numa lista " +
          "vazia (`200 []`), não em `404`.\n\n" +
          "**Restrito a administradores.**",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "ID do usuário (feitoPorId) a filtrar.", example: "user-admin-88" },
          },
        },
        response: {
          200: {
            description: "Lista dos registros de auditoria feitos por esse usuário (pode ser vazia).",
            type: "array",
            items: AuditoriaSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Usuário autenticado, mas sem papel ADMINISTRADOR.",
            ...ForbiddenErrorSchema,
          },
        },
      },
    },
    controller.listarPorUsuario
  );

  app.get(
    "/auditoria/periodo",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any,
        preQuery(ListarPorPeriodoSchema)
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Listar o histórico de auditoria dentro de um período",
        description:
          "Retorna os registros com `feitoEm` entre `inicio` e `fim` " +
          "(inclusive nos dois extremos — filtro `gte`/`lte`), ordenados do " +
          "mais recente para o mais antigo. `inicio`/`fim` chegam como texto " +
          "na querystring e são convertidos para `Date` antes de consultar o " +
          "banco.\n\n" +
          "**Restrito a administradores.**",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          required: ["inicio", "fim"],
          properties: {
            inicio: { type: "string", minLength: 8, description: "Data/hora inicial do período (formato ISO 8601 recomendado).", example: "2026-01-01" },
            fim: { type: "string", minLength: 8, description: "Data/hora final do período (formato ISO 8601 recomendado).", example: "2026-01-31" },
          },
        },
        response: {
          200: {
            description: "Lista dos registros de auditoria dentro do período informado (pode ser vazia).",
            type: "array",
            items: AuditoriaSchema,
          },
          400: {
            description: "`inicio` ou `fim` ausentes, ou com menos de 8 caracteres.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Usuário autenticado, mas sem papel ADMINISTRADOR.",
            ...ForbiddenErrorSchema,
          },
        },
      },
    },
    controller.listarPorPeriodo
  );

  app.post(
    "/auditoria",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any,
        preBody(RegistrarSchema)
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Registrar manualmente uma entrada de auditoria",
        description:
          "Cria um novo registro de auditoria diretamente pela API — uso " +
          "administrativo/manual, além dos registros automáticos gerados " +
          "internamente pelo sistema (ex.: login, troca de senha) via " +
          "`registrarAuditoria` (src/lib/auditoria.ts).\n\n" +
          "**Restrito a administradores.**",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["acao"],
          properties: {
            acao: { type: "string", minLength: 2, description: "Descrição curta e padronizada da ação (ex.: CHAMADO_FECHADO).", example: "CHAMADO_FECHADO" },
            alvo: { type: "string", nullable: true, description: "ID do recurso afetado pela ação, se houver.", example: "ticket-4521" },
            meta: { type: "object", nullable: true, additionalProperties: true, description: "Dados adicionais livres em formato JSON." },
            feitoPorId: { type: "string", nullable: true, description: "ID do usuário que executou a ação.", example: "user-admin-88" },
          },
        },
        response: {
          200: {
            description: "Registro de auditoria criado com sucesso.",
            ...AuditoriaSchema,
          },
          400: {
            description: "`acao` ausente ou com menos de 2 caracteres.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Usuário autenticado, mas sem papel ADMINISTRADOR.",
            ...ForbiddenErrorSchema,
          },
        },
      },
    },
    controller.registrar
  );
}