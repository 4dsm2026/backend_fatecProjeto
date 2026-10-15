import type { FastifyRequest, FastifyReply } from "fastify";
import {
  SetorCreateSchema, SetorUpdateSchema, SetorListSchema, SetorIdSchema,
} from "../../validators/setores";
import {
  createSetor, getSetorById, listSetores, updateSetor, deleteSetor,
} from "./setores.service";
import { buildSectorLinks } from "./setores.hateoas";
import {
  ApiError,
  buildLinks,
  isAdmin,
  link,
  parseOrThrow,
  pickFilters,
  toCollection,
  toResource,
  viewerFrom,
} from "../../hateoas";

/*
 * Os erros são lançados (ApiError / erros do Prisma) e convertidos em
 * `application/problem+json` pelo handler global (registerProblemHandler).
 * P2025 -> 404, P2002 -> 409, falha de validação -> 400.
 */

const LIST_FILTER_KEYS = ["search", "organizacaoId"] as const;

function notFound(): ApiError {
  return new ApiError("not-found", "Setor não encontrado");
}

/* POST /admin/sectors */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const body = parseOrThrow(SetorCreateSchema.shape.body, req.body);
  const viewer = viewerFrom(req);

  const setor = await createSetor(req.server.prisma, body);
  const links = buildSectorLinks(setor, viewer);

  return res
    .code(201)
    .header("Location", (links.self as { href: string }).href)
    .send(toResource(setor, links));
}

/* GET /admin/sectors/:id */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const { id } = parseOrThrow(SetorIdSchema.shape.params, req.params);
  const viewer = viewerFrom(req);

  const setor = await getSetorById(req.server.prisma, id);
  if (!setor) throw notFound();

  return res.code(200).send(toResource(setor, buildSectorLinks(setor, viewer)));
}

/* GET /admin/sectors?page=&size=&search=&organizacaoId= */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const query = parseOrThrow(SetorListSchema.shape.query, req.query);
  const viewer = viewerFrom(req);

  const result = await listSetores(req.server.prisma, query);

  const collection = toCollection({
    rel: "sectors",
    basePath: "/admin/sectors",
    items: result.data.map((setor) => toResource(setor, buildSectorLinks(setor, viewer))),
    page: result.page,
    size: result.size,
    total: result.total,
    filters: pickFilters(query, LIST_FILTER_KEYS),
    links: buildLinks({
      create: isAdmin(viewer) && link("/admin/sectors", "POST"),
    }),
  });

  return res.code(200).send(collection);
}

/* PATCH /admin/sectors/:id */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const { id } = parseOrThrow(SetorUpdateSchema.shape.params, req.params);
  const body = parseOrThrow(SetorUpdateSchema.shape.body, req.body);
  const viewer = viewerFrom(req);
  const prisma = req.server.prisma;

  if (!(await getSetorById(prisma, id))) throw notFound();

  const setor = await updateSetor(prisma, id, body);
  return res.code(200).send(toResource(setor, buildSectorLinks(setor, viewer)));
}

/* DELETE /admin/sectors/:id */
export async function removeHard(req: FastifyRequest, res: FastifyReply) {
  const { id } = parseOrThrow(SetorIdSchema.shape.params, req.params);
  const prisma = req.server.prisma;

  if (!(await getSetorById(prisma, id))) throw notFound();

  await deleteSetor(prisma, id);
  return res.code(204).send();
}
