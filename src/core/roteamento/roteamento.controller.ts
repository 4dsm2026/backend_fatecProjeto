import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toResource, viewerFrom } from "../../hateoas";
import { HierarquiaSchema, RegraAtualizarSchema, RegraCriarSchema, RegraIdSchema, SetorIdSchema, SimularSchema } from "../../validators/roteamento";
import { RULES, linksDaHierarquia, linksDaRegra, linksDasRegras } from "./roteamento.links";
import { atualizarRegra, criarRegra, excluirRegra, lerHierarquia, listarRegras, salvarHierarquia, simular } from "./roteamento.service";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

export async function listRules(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const regras = await listarRegras(req.server.prisma, viewer);
  return reply.send({
    total: regras.length,
    _embedded: { "routing-rules": regras.map((r) => toResource(r, linksDaRegra(r.id))) },
    _links: linksDasRegras(),
  });
}

export async function createRule(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(RegraCriarSchema, { body: req.body });
  const regra = await criarRegra(req.server.prisma, body, viewer);
  return reply.code(201).header("Location", `${RULES}/${encodeURIComponent(regra.id)}`).send(toResource(regra, linksDaRegra(regra.id)));
}

export async function updateRule(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(RegraAtualizarSchema, { params: req.params, body: req.body });
  const regra = await atualizarRegra(req.server.prisma, params.id, body, viewer);
  return reply.send(toResource(regra, linksDaRegra(regra.id)));
}

export async function deleteRule(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(RegraIdSchema, { params: req.params });
  await excluirRegra(req.server.prisma, params.id, viewer);
  return reply.code(204).send();
}

export async function getSectorRouting(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(SetorIdSchema, { params: req.params });
  const h = await lerHierarquia(req.server.prisma, params.id, viewer);
  return reply.send(toResource(h, linksDaHierarquia(h.id)));
}

export async function putSectorRouting(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(HierarquiaSchema, { params: req.params, body: req.body });
  const h = await salvarHierarquia(req.server.prisma, params.id, body, viewer);
  return reply.send(toResource(h, linksDaHierarquia(h.id)));
}

export async function preview(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(SimularSchema, { body: req.body ?? {} });
  return reply.send(await simular(req.server.prisma, body, viewer));
}
