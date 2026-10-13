import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { parseRoute, sendNotFound } from "../../utils/http";
import {
  SetorCreateSchema, SetorUpdateSchema, SetorListSchema, SetorIdSchema
} from "../../validators/setores";
import {
  createSetor, getSetorById, listSetores, updateSetor, deleteSetor
} from "./setores.service";
import type { SetoresListQuery } from "./setores.types";


import { toResource } from "../../hateoas/resource";
import { buildLinks, link, path } from "../../hateoas/links";
import { toCollection } from "../../hateoas/pagination";


const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const createValidator = buildRouteValidator({ body: SetorCreateSchema.shape.body });
const listValidator = buildRouteValidator({ query: SetorListSchema.shape.query });
const idValidator = buildRouteValidator({ params: SetorIdSchema.shape.params });
const updateValidator = buildRouteValidator({
  params: SetorUpdateSchema.shape.params,
  body: SetorUpdateSchema.shape.body,
});

function setorLinks(id: string) {
  const setorPath = path`/admin/sectors/${id}`;

  return buildLinks({
    self: link(setorPath),
    collection: link("/admin/sectors"),
    update: link(setorPath, "PATCH"),
    delete: link(setorPath, "DELETE"),
  });
}

/* POST /setores */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const data = parseRoute<{ body?: typeof SetorCreateSchema.shape.body._output }>(createValidator, req, res);
  if (!data) return;
  const prisma = req.server.prisma;
  try {
    const setor = await createSetor(prisma, data.body!);
    await res.code(201).send(toResource(setor, setorLinks(setor.id)));
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /setores/:id */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const data = parseRoute<{ params?: typeof SetorIdSchema.shape.params._output }>(idValidator, req, res);
  if (!data) return;
  const prisma = req.server.prisma;
  try {
    const setor = await getSetorById(prisma, data.params!.id);
    if (!setor) return sendNotFound(res, "Setor");
    await res.send(toResource(setor, setorLinks(setor.id)));
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao buscar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}


/* GET /admin/sectors */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const data = parseRoute<{
    query?: typeof SetorListSchema.shape.query._output;
  }>(listValidator, req, res);

  if (!data) return;

  const prisma = req.server.prisma;

  try {
    const query = data.query! as SetoresListQuery;
    const result = await listSetores(prisma, query);

    const items = result.data.map((setor) =>
      toResource(setor, setorLinks(setor.id))
    );

    const filters = {
      ...(query.search ? { search: query.search } : {}),
      ...(query.organizacaoId
        ? { organizacaoId: query.organizacaoId }
        : {}),
    };

    const collection = toCollection({
      rel: "sectors",
      basePath: "/admin/sectors",
      items,
      page: Math.max(result.page - 1, 0),
      size: result.perPage,
      total: result.total,
      filters,
    });

    await res.send(collection);
  } catch (e) {
    req.log.error({ e }, "Erro ao listar setores");
    await res.code(500).send({ error: errMsg(e) });
  }
}


/* PATCH /setores/:id */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const data = parseRoute<{ params?: typeof SetorUpdateSchema.shape.params._output; body?: typeof SetorUpdateSchema.shape.body._output }>(updateValidator, req, res);
  if (!data) return;
  const prisma = req.server.prisma;
  try {
    const setor = await updateSetor(prisma, data.params!.id, data.body!);
    await res.send(toResource(setor, setorLinks(setor.id)));
  } catch (e: any) {
    if (e?.code === "P2025") return sendNotFound(res, "Setor");
    req.log.error({ e }, "💥 Erro ao atualizar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* DELETE /setores/:id */
export async function removeHard(req: FastifyRequest, res: FastifyReply) {
  const data = parseRoute<{ params?: typeof SetorIdSchema.shape.params._output }>(idValidator, req, res);
  if (!data) return;
  const prisma = req.server.prisma;
  try {
    await deleteSetor(prisma, data.params!.id);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") return sendNotFound(res, "Setor");
    req.log.error({ e }, "💥 Erro ao excluir setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}
