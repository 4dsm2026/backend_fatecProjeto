import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, buildLinks, fieldErrorsFromZod, link, path, toCollection, toResource } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { PapelCreateSchema, PapelIdSchema, PapelUpdateSchema } from "../../validators/papeis";
import { createPapel, deletePapel, getPapel, listPapeis, updatePapel } from "./papeis.service";
import { buildPapelLinks, PapeisListQuerySchema } from "./papeis.types";
import type { PapelPublic, PapelWithUsage } from "./papeis.types";

function parseOrThrow<T extends z.ZodType<unknown>>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, fieldErrorsFromZod(result.error.issues));
  }
  return result.data as z.output<T>;
}

function requestViewer(req: FastifyRequest): Viewer {
  if (!req.user?.sub) throw new ApiError("unauthorized", "Não autenticado");
  if (req.user.role !== "ADMINISTRADOR") throw new ApiError("forbidden", "Acesso negado");
  return { id: req.user.sub, role: "ADMINISTRADOR" };
}

function publicPapel(papel: PapelWithUsage): PapelPublic {
  const { id, nome, descricao } = papel;
  return { id, nome, descricao };
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = parseOrThrow(PapeisListQuerySchema, req.query);
  const viewer = requestViewer(req);
  const result = await listPapeis(req.server.prisma, query);
  const items = result.items.map((papel) => toResource(publicPapel(papel), buildPapelLinks(papel, viewer)));

  return reply.send(toCollection({
    rel: "roles",
    basePath: "/admin/roles",
    items,
    page: query.page,
    size: query.size,
    total: result.total,
    links: buildLinks({ create: viewer.role === "ADMINISTRADOR" && link("/admin/roles", "POST") }),
  }));
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const body = parseOrThrow(PapelCreateSchema.shape.body, req.body);
  const viewer = requestViewer(req);
  const papel = await createPapel(req.server.prisma, body);
  const location = path`/admin/roles/${papel.id}`;

  return reply.header("Location", location).code(201).send(
    toResource(publicPapel(papel), buildPapelLinks(papel, viewer)),
  );
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(PapelIdSchema.shape.params, req.params);
  const viewer = requestViewer(req);
  const papel = await getPapel(req.server.prisma, id);
  if (!papel) throw new ApiError("not-found", "Papel não encontrado");

  return reply.send(toResource(publicPapel(papel), buildPapelLinks(papel, viewer)));
}

export async function patch(req: FastifyRequest, reply: FastifyReply) {
  const params = parseOrThrow(PapelUpdateSchema.shape.params, req.params);
  const body = parseOrThrow(PapelUpdateSchema.shape.body, req.body);
  const viewer = requestViewer(req);
  const papel = await updatePapel(req.server.prisma, params.id, body);

  return reply.send(toResource(publicPapel(papel), buildPapelLinks(papel, viewer)));
}

export async function removeHard(req: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(PapelIdSchema.shape.params, req.params);
  requestViewer(req);
  await deletePapel(req.server.prisma, id);
  return reply.code(204).send();
}
