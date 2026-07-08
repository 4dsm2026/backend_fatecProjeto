import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import {
  SetorCreateSchema, SetorUpdateSchema, SetorListSchema, SetorIdSchema
} from "../../validators/setores";
import {
  createSetor, getSetorById, listSetores, updateSetor, deleteSetor
} from "./setores.service";
import type { SetoresListQuery } from "./setores.types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const createValidator = buildRouteValidator({ body: SetorCreateSchema.shape.body });
const listValidator   = buildRouteValidator({ query: SetorListSchema.shape.query });
const idValidator     = buildRouteValidator({ params: SetorIdSchema.shape.params });
const updateValidator = buildRouteValidator({
  params: SetorUpdateSchema.shape.params,
  body:   SetorUpdateSchema.shape.body,
});

/* POST /setores */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = req.server.prisma;
  try {
    const setor = await createSetor(prisma, parsed.data!.body!);
    await res.code(201).send(setor);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /setores/:id */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = req.server.prisma;
  try {
    const setor = await getSetorById(prisma, parsed.data!.params!.id);
    if (!setor) return void (await res.code(404).send({ error: "Setor não encontrado" }));
    await res.send(setor);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao buscar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /setores */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = req.server.prisma;
  try {
    const page = await listSetores(prisma, parsed.data!.query! as SetoresListQuery);
    await res.send(page);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar setores");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* PATCH /setores/:id */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const parsed = updateValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = req.server.prisma;
  try {
    const setor = await updateSetor(prisma, parsed.data!.params!.id, parsed.data!.body!);
    await res.send(setor);
  } catch (e: any) {
    if (e?.code === "P2025") return void (await res.code(404).send({ error: "Setor não encontrado" }));
    req.log.error({ e }, "💥 Erro ao atualizar setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* DELETE /setores/:id */
export async function removeHard(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = req.server.prisma;
  try {
    await deleteSetor(prisma, parsed.data!.params!.id);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") return void (await res.code(404).send({ error: "Setor não encontrado" }));
    req.log.error({ e }, "💥 Erro ao excluir setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}
