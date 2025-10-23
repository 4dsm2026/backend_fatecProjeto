import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { PapelCreateSchema, PapelUpdateSchema, PapelIdSchema } from "../../validators/papeis";
import { listPapeis, createPapel, getPapel, updatePapel, deletePapel } from "./papeis.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const createValidator = buildRouteValidator({ body:   PapelCreateSchema.shape.body });
const idValidator     = buildRouteValidator({ params: PapelIdSchema.shape.params });
const updateValidator = buildRouteValidator({
  params: PapelUpdateSchema.shape.params,
  body:   PapelUpdateSchema.shape.body,
});

/* GET /papeis */
export async function list(_req: FastifyRequest, res: FastifyReply) {
  const prisma = (_req.server as any).prisma;
  try {
    const data = await listPapeis(prisma);
    await res.send(data);
  } catch (e) {
    _req.log.error({ e }, "💥 Erro ao listar papéis");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /papeis */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const papel = await createPapel(prisma, parsed.data!.body!);
    await res.code(201).send(papel);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar papel");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /papeis/:id */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const papel = await getPapel(prisma, parsed.data!.params!.id);
    if (!papel) return void (await res.code(404).send({ error: "Papel não encontrado" }));
    await res.send(papel);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao buscar papel");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* PATCH /papeis/:id */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const parsed = updateValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const papel = await updatePapel(prisma, parsed.data!.params!.id, parsed.data!.body!);
    await res.send(papel);
  } catch (e: any) {
    if (e?.code === "P2025") return void (await res.code(404).send({ error: "Papel não encontrado" }));
    req.log.error({ e }, "💥 Erro ao atualizar papel");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* DELETE /papeis/:id */
export async function removeHard(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    await deletePapel(prisma, parsed.data!.params!.id);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.statusCode === 409) return void (await res.code(409).send({ error: e.message }));
    if (e?.code === "P2025")   return void (await res.code(404).send({ error: "Papel não encontrado" }));
    req.log.error({ e }, "💥 Erro ao remover papel");
    await res.code(500).send({ error: errMsg(e) });
  }
}
