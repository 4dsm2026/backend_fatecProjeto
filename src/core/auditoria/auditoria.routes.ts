import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuditoriaController } from "./auditoria.controller";
import { buildRouteValidator, zStringTrim } from "../../utils/zod-helpers";
import { z } from "zod";

const controller = new AuditoriaController();

// ----- Zod Schemas -----

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

// Helpers iguais do seu auth.routes.ts
const preBody =
  (schema: z.ZodTypeAny) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const v = buildRouteValidator({ body: schema }).parse(req);
      if ("error" in v) {
        await reply.code(400).send(v.error);
        return;
      }
    };

const preQuery =
  (schema: z.ZodTypeAny) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const v = buildRouteValidator({ query: schema }).parse(req);
      if ("error" in v) {
        await reply.code(400).send(v.error);
        return;
      }
    };

// ----- Rotas -----

export default async function auditoriaRoutes(app: FastifyInstance) {
  // Apenas usuários autenticados podem ver auditoria
  // Depois podemos aplicar o "apenas gestor"

  app.get(
    "/auditoria",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any
      ]
    },
    controller.listar
  );

  app.get(
    "/auditoria/usuario/:id",
    {
      preHandler: [
        app.authenticate as any,
        app.authorize(["ADMINISTRADOR"]) as any
      ]
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
      ]
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
      ]
    },
    controller.registrar
  );
}
