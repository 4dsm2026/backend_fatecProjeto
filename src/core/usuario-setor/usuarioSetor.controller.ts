import type { FastifyRequest, FastifyReply } from "fastify";
import {
  VincularUsuarioSetorSchema,
  AlterarPapelUsuarioSetorSchema,
  ListUsuariosDoSetorSchema,
  ListSetoresDoUsuarioSchema,
} from "../../validators/usuario-setor.js";
import {
  vincularUsuarioSetor,
  alterarPapelNoSetor,
  desvincularUsuarioSetor,
  listarUsuariosDoSetor,
  listarSetoresDoUsuario,
} from "./usuarioSetor.service.js";
import { buildUserSectorLinks } from "./usuarioSetor.hateoas.js";
import {
  ApiError,
  parseOrThrow,
  pickFilters,
  toCollection,
  toResource,
  viewerFrom,
} from "../../hateoas/index.js";

/* POST /admin/users/:id/sectors (or /users/:usuarioId/sectors) */
export async function vincular(req: FastifyRequest, res: FastifyReply) {
  const params = parseOrThrow(VincularUsuarioSetorSchema.shape.params, req.params);
  const body = parseOrThrow(VincularUsuarioSetorSchema.shape.body, req.body);
  const usuarioId = params.id ?? params.usuarioId!;
  const viewer = viewerFrom(req);
  const prisma = req.server.prisma;

  const vinculo = await vincularUsuarioSetor(prisma, usuarioId, body);
  const links = buildUserSectorLinks(vinculo, viewer);

  return res
    .code(201)
    .header("Location", (links.self as { href: string }).href)
    .send(toResource(vinculo, links));
}

/* PATCH /admin/user-sectors/:id (or /user-sectors/:usuarioSetorId) */
export async function alterarPapel(req: FastifyRequest, res: FastifyReply) {
  const params = parseOrThrow(AlterarPapelUsuarioSetorSchema.shape.params, req.params);
  const body = parseOrThrow(AlterarPapelUsuarioSetorSchema.shape.body, req.body);
  const usuarioSetorId = params.id ?? params.usuarioSetorId!;
  const viewer = viewerFrom(req);
  const prisma = req.server.prisma;

  const updated = await alterarPapelNoSetor(prisma, usuarioSetorId, body);
  return res.code(200).send(toResource(updated, buildUserSectorLinks(updated, viewer)));
}

/* DELETE /admin/user-sectors/:id (or /user-sectors/:usuarioSetorId) */
export async function desvincular(req: FastifyRequest, res: FastifyReply) {
  const rawParams = req.params as Record<string, string> | undefined;
  const usuarioSetorId = rawParams?.id ?? rawParams?.usuarioSetorId;
  if (!usuarioSetorId) {
    throw new ApiError("bad-request", "usuarioSetorId obrigatório");
  }
  const prisma = req.server.prisma;

  await desvincularUsuarioSetor(prisma, usuarioSetorId);
  return res.code(204).send();
}

/* GET /admin/sectors/:id/users (or /sectors/:setorId/users) */
export async function listUsuariosDoSetor(req: FastifyRequest, res: FastifyReply) {
  const params = parseOrThrow(ListUsuariosDoSetorSchema.shape.params, req.params);
  const query = parseOrThrow(ListUsuariosDoSetorSchema.shape.query, req.query);
  const setorId = params.id ?? params.setorId!;
  const viewer = viewerFrom(req);
  const prisma = req.server.prisma;

  const page = query.page ?? 0;
  const size = query.size ?? query.perPage ?? 20;

  const result = await listarUsuariosDoSetor(prisma, setorId, { page, size, search: query.search });

  const collection = toCollection({
    rel: "users",
    basePath: `/admin/sectors/${setorId}/users`,
    items: result.data.map((item) => toResource(item, buildUserSectorLinks(item, viewer))),
    page: result.page,
    size: result.size,
    total: result.total,
    filters: pickFilters(query, ["search"]),
  });

  return res.code(200).send(collection);
}

/* GET /admin/users/:id/sectors (or /users/:usuarioId/sectors) */
export async function listSetoresDoUsuario(req: FastifyRequest, res: FastifyReply) {
  const params = parseOrThrow(ListSetoresDoUsuarioSchema.shape.params, req.params);
  const query = parseOrThrow(ListSetoresDoUsuarioSchema.shape.query, req.query);
  const usuarioId = params.id ?? params.usuarioId!;
  const viewer = viewerFrom(req);
  const prisma = req.server.prisma;

  const page = query.page ?? 0;
  const size = query.size ?? query.perPage ?? 20;

  const result = await listarSetoresDoUsuario(prisma, usuarioId, { page, size });

  const collection = toCollection({
    rel: "sectors",
    basePath: `/admin/users/${usuarioId}/sectors`,
    items: result.data.map((item) => toResource(item, buildUserSectorLinks(item, viewer))),
    page: result.page,
    size: result.size,
    total: result.total,
  });

  return res.code(200).send(collection);
}
