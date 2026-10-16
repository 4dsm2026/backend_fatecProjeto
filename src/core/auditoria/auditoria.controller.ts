import { FastifyRequest, FastifyReply } from "fastify";
import { buildAuditLogCollectionLinks, buildAuditLogLinks } from "./auditoria.hateoas";
import { AuditoriaService } from "./auditoria.service";
import { toCollection, toResource, viewerFrom } from "../../hateoas";
import { AuditoriaListQuerySchema } from "./auditoria.types";
import type { RegistrarAuditoriaDTO } from "./auditoria.types";

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

  registrar = async (
    req: FastifyRequest<{ Body: RegistrarAuditoriaDTO }>,
    reply: FastifyReply
  ) => {
    const log = await this.service.registrar(req.body);
    const viewer = viewerFrom(req);
    return reply.code(201).send(toResource(log, buildAuditLogLinks(log, viewer)));
  };
}