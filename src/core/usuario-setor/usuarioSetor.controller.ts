import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { sendNotFound, sendReply, sendValidationError } from "../../utils/http";
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


import { link, buildLinks, path } from "../../hateoas/links";
import { toResource } from "../../hateoas/resource";


const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const vincularValidator = buildRouteValidator({
  params: VincularUsuarioSetorSchema.shape.params,
  body: VincularUsuarioSetorSchema.shape.body,
});
const alterarValidator = buildRouteValidator({
  params: AlterarPapelUsuarioSetorSchema.shape.params,
  body: AlterarPapelUsuarioSetorSchema.shape.body,
});
const listUsersValidator = buildRouteValidator({
  params: ListUsuariosDoSetorSchema.shape.params,
  query: ListUsuariosDoSetorSchema.shape.query,
});
const listSetoresValidator = buildRouteValidator({
  params: ListSetoresDoUsuarioSchema.shape.params,
  query: ListSetoresDoUsuarioSchema.shape.query,
});


function usuarioSetorComLinks<
  T extends { id: string; usuarioId: string; setorId: string }
>(vinculo: T) {
  const vinculoPath = path`/admin/user-sectors/${vinculo.id}`;

  const links = buildLinks({
    update: link(vinculoPath, "PATCH", {
      title: "Alterar papel do vínculo",
    }),

    delete: link(vinculoPath, "DELETE", {
      title: "Remover vínculo",
    }),

    "user-sectors": link(
      path`/admin/users/${vinculo.usuarioId}/sectors`,
      "GET",
      { title: "Listar setores do usuário" }
    ),

    "sector-users": link(
      path`/admin/sectors/${vinculo.setorId}/users`,
      "GET",
      { title: "Listar usuários do setor" }
    ),
  });

  return toResource(vinculo, links);
}


/* POST /usuarios/:usuarioId/setores */
export async function vincular(req: FastifyRequest, res: FastifyReply) {
  const parsed = vincularValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);
  const prisma = req.server.prisma;
  try {
    const r = await vincularUsuarioSetor(prisma, parsed.data!.params!.usuarioId, parsed.data!.body!);
    await res.code(201).send(usuarioSetorComLinks(r));
  } catch (e: any) {
    if (e?.statusCode === 409) return sendReply(res, 409, { error: e.message });
    req.log.error({ e }, "💥 Erro ao vincular usuário ao setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* PATCH /usuarios-setores/:usuarioSetorId */
export async function alterarPapel(req: FastifyRequest, res: FastifyReply) {
  const parsed = alterarValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);
  const prisma = req.server.prisma;
  try {
    const r = await alterarPapelUsuarioSetor(prisma, parsed.data!.params!.usuarioSetorId, parsed.data!.body!);
    await res.send(usuarioSetorComLinks(r));
  } catch (e: any) {
    if (e?.code === "P2025") return sendNotFound(res, "Vínculo");
    req.log.error({ e }, "💥 Erro ao alterar papel do vínculo");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* DELETE /usuarios-setores/:usuarioSetorId */
export async function desvincular(req: FastifyRequest, res: FastifyReply) {
  const prisma = req.server.prisma;
  const usuarioSetorId = (req.params as any)?.usuarioSetorId as string;
  if (!usuarioSetorId) return sendReply(res, 400, { error: "usuarioSetorId obrigatório" });
  try {
    await desvincularUsuarioSetor(prisma, usuarioSetorId);
    await res.code(204).send();
  } catch (e: any) {
    if (e?.code === "P2025") return sendNotFound(res, "Vínculo");
    req.log.error({ e }, "💥 Erro ao desvincular usuário do setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /setores/:setorId/usuarios */
export async function listUsuariosDoSetor(req: FastifyRequest, res: FastifyReply) {
  const parsed = listUsersValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);
  const prisma = req.server.prisma;
  try {
    const r = await listarUsuariosDoSetor(prisma, parsed.data!.params!.setorId, parsed.data!.query!);
    const data = r.data.map((vinculo) =>
      usuarioSetorComLinks(vinculo)
    );

    await res.send({
      ...r,
      data,
    });
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar usuários do setor");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /usuarios/:usuarioId/setores */
export async function listSetoresDoUsuario(req: FastifyRequest, res: FastifyReply) {
  const parsed = listSetoresValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);
  const prisma = req.server.prisma;
  try {
    const r = await listarSetoresDoUsuario(prisma, parsed.data!.params!.usuarioId, parsed.data!.query!);

    const data = r.data.map((vinculo) =>
      usuarioSetorComLinks(vinculo)
    );

    await res.send({
      ...r,
      data,
    });

  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar setores do usuário");
    await res.code(500).send({ error: errMsg(e) });
  }
}
