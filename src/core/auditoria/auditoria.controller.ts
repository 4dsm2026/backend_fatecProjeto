import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { buildAuditLogCollectionLinks, buildAuditLogLinks } from "./auditoria.hateoas";
import { AuditoriaService } from "./auditoria.service";
import { ApiError, parseOrThrow, path, toCollection, toResource, viewerFrom } from "../../hateoas";
import { AuditoriaListQuerySchema } from "./auditoria.types";
import type { RegistrarAuditoriaDTO } from "./auditoria.types";

const AuditoriaByIdSchema = z.object({
  params: z.object({ id: z.string().trim().min(1) }),
});

export class AuditoriaController {
  constructor(private readonly service: AuditoriaService = new AuditoriaService()) {}

  listar = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = AuditoriaListQuerySchema.parse(req.query);
    const viewer = viewerFrom(req);
    const result = await this.service.listar(query);
    const collection = toCollection({
      rel: "audit-logs",
      basePath: "/admin/audit-logs",
      items: result.items.map((log) => toResource(log, buildAuditLogLinks(log, viewer))),
      page: query.page,
      size: query.size,
      total: result.total,
      filters: {
        userId: query.userId,
        from: query.from?.toISOString(),
        to: query.to?.toISOString(),
      },
      links: buildAuditLogCollectionLinks(viewer),
    });
    return reply.send(collection);
  };

  obterPorId = async (req: FastifyRequest, reply: FastifyReply) => {
    const { params } = parseOrThrow(AuditoriaByIdSchema, { params: req.params });
    const viewer = viewerFrom(req);
    const log = await this.service.obterPorId(params.id);
    return reply.send(toResource(log, buildAuditLogLinks(log, viewer)));
  };

  registrar = async (
    req: FastifyRequest<{ Body: RegistrarAuditoriaDTO }>,
    reply: FastifyReply
  ) => {
    const viewer = viewerFrom(req);
    if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
    const log = await this.service.registrar(req.body, viewer.id);
    return reply
      .header("Location", path`/admin/audit-logs/${log.id}`)
      .code(201)
      .send(toResource(log, buildAuditLogLinks(log, viewer)));
  };
}