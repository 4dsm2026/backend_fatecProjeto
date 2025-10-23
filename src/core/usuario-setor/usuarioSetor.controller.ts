import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import {
  VincularUsuarioSetorSchema,
  AlterarPapelUsuarioSetorSchema,
  ListUsuariosDoSetorSchema,
  ListSetoresDoUsuarioSchema,
} from "../../validators/usuario-setor";
import {
  vincularUsuarioSetor,
  alterarPapelUsuarioSetor,
  desvincularUsuarioSetor,
  listarUsuariosDoSetor,
  listarSetoresDoUsuario,
} from "./usuarioSetor.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const vincularValidator  = buildRouteValidator({
  params: VincularUsuarioSetorSchema.shape.params,
  body:   VincularUsuarioSetorSchema.shape.body,
});
const alterarValidator   = buildRouteValidator({
  params: AlterarPapelUsuarioSetorSchema.shape.params,
  body:   AlterarPapelUsuarioSetorSchema.shape.body,
});
const listUsersValidator = buildRouteValidator({
  params: ListUsuariosDoSetorSchema.shape.params,
  query:  ListUsuariosDoSetorSchema.shape.query,
});
const listSetoresValidator = buildRouteValidator({
  params: ListSetoresDoUsuarioSchema.shape.params,
  query:  ListSetoresDoUsuarioSchema.shape.query,
});

/* POST /usuarios/:usuarioId/setores */
export async function vincular(req: FastifyRequest, res: FastifyReply) {
  const parsed = vincularValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const r = await vincularUsuarioSetor(prisma, parsed.data!.params!.usuarioId, parsed.data!.body!);
    await res.code(201).send(r);
  } catch (e: any) {
    if (e?.statusCode === 409) return void (await res.code(409).send({ error: e.message }));
    req.log.error({ e }, "💥 Erro ao vincular usuário ao setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* PATCH /usuarios-setores/:usuarioSetorId */
export async function alterarPapel(req: FastifyRequest, res: FastifyReply) {
  const parsed = alterarValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const r = await alterarPapelUsuarioSetor(prisma, parsed.data!.params!.usuarioSetorId, parsed.data!.body!);
    await res.send(r);
  } catch (e: any) {
    if (e?.code === "P2025") return void (await res.code(404).send({ error: "Vínculo não encontrado" }));
    req.log.error({ e }, "💥 Erro ao alterar papel do vínculo");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* DELETE /usuarios-setores/:usuarioSetorId */
export async function desvincular(req: FastifyRequest, res: FastifyReply) {
  const prisma = (req.server as any).prisma;
  const usuarioSetorId = (req.params as any)?.usuarioSetorId as string;
  if (!usuarioSetorId) return void (await res.code(400).send({ error: "usuarioSetorId obrigatório" }));
  try {
    await desvincularUsuarioSetor(prisma, usuarioSetorId);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") return void (await res.code(404).send({ error: "Vínculo não encontrado" }));
    req.log.error({ e }, "💥 Erro ao desvincular usuário do setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /setores/:setorId/usuarios */
export async function listUsuariosDoSetor(req: FastifyRequest, res: FastifyReply) {
  const parsed = listUsersValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const r = await listarUsuariosDoSetor(prisma, parsed.data!.params!.setorId, parsed.data!.query!);
    await res.send(r);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar usuários do setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /usuarios/:usuarioId/setores */
export async function listSetoresDoUsuario(req: FastifyRequest, res: FastifyReply) {
  const parsed = listSetoresValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const r = await listarSetoresDoUsuario(prisma, parsed.data!.params!.usuarioId, parsed.data!.query!);
    await res.send(r);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar setores do usuário");
    await res.code(500).send({ error: errMsg(e) });
  }
}
