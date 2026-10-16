import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import { zStringTrim } from "../../utils/zod-helpers";
import { AuditoriaController } from "./auditoria.controller";
import type { RegistrarAuditoriaDTO } from "./auditoria.types";

const controller = new AuditoriaController();

const RegistrarSchema = z.object({
  acao: zStringTrim.min(2),
  alvo: zStringTrim.optional(),
  meta: z.unknown().optional(),
  feitoPorId: zStringTrim.optional(),
});

const preBody =
  (schema: z.ZodTypeAny) =>
  async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    req.body = schema.parse(req.body);
  };

const AuditLogSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    acao: { type: "string" },
    alvo: { type: "string", nullable: true },
    meta: { nullable: true, additionalProperties: true },
    feitoPorId: { type: "string", nullable: true },
    feitoEm: { type: "string", format: "date-time" },
    feitoPor: {
      type: "object",
      nullable: true,
      properties: {
        id: { type: "string" },
        nome: { type: "string" },
        ra: { type: "string", nullable: true },
      },
    },
    _links: { type: "object", additionalProperties: true },
  },
} as const;

const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
  },
} as const;

export default async function auditoriaRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  app.get(
    "/admin/audit-logs",
    {
      preHandler: [
        app.authenticate as never,
        app.authorize(["ADMINISTRADOR"]) as never,
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Listar registros de auditoria",
        description:
          "Lista o histórico para administradores. `userId`, `from` e `to` são filtros opcionais; " +
          "`page` começa em zero e `size` aceita de 1 a 100. A coleção não oferece link individual " +
          "porque atualmente não existe uma rota de consulta de log por ID.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            userId: { type: "string" },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["_embedded", "page", "_links"],
            properties: {
              _embedded: {
                type: "object",
                properties: {
                  "audit-logs": { type: "array", items: AuditLogSchema },
                },
              },
              page: {
                type: "object",
                properties: {
                  size: { type: "integer" },
                  number: { type: "integer" },
                  totalElements: { type: "integer" },
                  totalPages: { type: "integer" },
                },
              },
              _links: { type: "object", additionalProperties: true },
            },
          },
          400: ProblemSchema,
          401: ProblemSchema,
          403: ProblemSchema,
          500: ProblemSchema,
        },
      },
    },
    controller.listar,
  );

  app.post<{ Body: RegistrarAuditoriaDTO }>(
    "/admin/audit-logs",
    {
      preHandler: [
        app.authenticate as never,
        app.authorize(["ADMINISTRADOR"]) as never,
        preBody(RegistrarSchema),
      ],
      schema: {
        tags: ["Auditoria"],
        summary: "Registrar manualmente uma entrada de auditoria",
        description:
          "Mantém a operação de registro manual existente, restrita a administradores. " +
          "O recurso criado retorna links para a coleção e para o usuário autor, se informado.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["acao"],
          properties: {
            acao: { type: "string", minLength: 2 },
            alvo: { type: "string" },
            meta: { type: "object", additionalProperties: true },
            feitoPorId: { type: "string" },
          },
        },
        response: {
          201: AuditLogSchema,
          400: ProblemSchema,
          401: ProblemSchema,
          403: ProblemSchema,
          500: ProblemSchema,
        },
      },
    },
    controller.registrar,
  );
}
