import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, viewerFrom } from "../../hateoas";
import {
  ParamsWithIdSchema,
  PasseEscolarCreateSchema,
  PasseEscolarExportSchema,
  PasseEscolarListSchema,
  PasseEscolarTransitionSchema,
  PasseEscolarUpdateSchema,
} from "../../validators/passe-escolar";
import { SCHOOL_PASSES, buildPasseCollectionLinks, passeSelfHref, toPasseResource } from "./passe-escolar.links";
import type { StatusPasseEscolar } from "./passe-escolar.rules";
import {
  createPasse,
  exportPassesCsv,
  getPasse,
  listPasses,
  transitionPasse,
  updatePasse,
} from "./passe-escolar.service";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(PasseEscolarCreateSchema, { body: req.body });
  const passe = await createPasse(req.server.prisma, body, viewer);
  return reply.header("Location", passeSelfHref(passe.id)).code(201).send(toPasseResource(passe, viewer));
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(PasseEscolarListSchema, { query: req.query });
  const q = { ...query, status: query.status as StatusPasseEscolar[] | undefined };
  const result = await listPasses(req.server.prisma, q, viewer);

  return reply.send(
    toCollection({
      rel: "school-passes",
      basePath: SCHOOL_PASSES,
      items: result.items.map((p) => toPasseResource(p, viewer)),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: { status: q.status, ano: q.ano, ativos: q.ativos, search: q.search },
      links: buildPasseCollectionLinks(viewer),
    }),
  );
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  const passe = await getPasse(req.server.prisma, params.id, viewer);
  return reply.send(toPasseResource(passe, viewer));
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PasseEscolarUpdateSchema, { params: req.params, body: req.body });
  const passe = await updatePasse(req.server.prisma, params.id, body, viewer);
  return reply.send(toPasseResource(passe, viewer));
}

export async function transition(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PasseEscolarTransitionSchema, { params: req.params, body: req.body });
  const passe = await transitionPasse(
    req.server.prisma,
    params.id,
    { ...body, status: body.status as StatusPasseEscolar },
    viewer,
  );
  return reply.send(toPasseResource(passe, viewer));
}

export async function exportCsv(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(PasseEscolarExportSchema, { query: req.query });
  const csv = await exportPassesCsv(
    req.server.prisma,
    { ano: query.ano, status: query.status as StatusPasseEscolar[] | undefined },
    viewer,
  );
  const nome = `passe-escolar-${query.ano ?? "todos"}.csv`;
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${nome}"`)
    .send(csv);
}
