import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, toResource, viewerFrom } from "../../hateoas";
import {
  ParamsWithIdSchema,
  PesquisaCopySchema,
  PesquisaCreateSchema,
  PesquisaListSchema,
  PesquisaRespostaSchema,
  PesquisaResultadosSchema,
  PesquisaStatusSchema,
  PesquisaUpdateSchema,
} from "../../validators/pesquisas";
import { SURVEYS, buildPesquisaCollectionLinks, pesquisaSelfHref, toPesquisaResource } from "./pesquisas.links";
import type { StatusPesquisa } from "./pesquisas.rules";
import {
  copyPesquisa,
  createPesquisa,
  deletePesquisa,
  getPesquisa,
  listPesquisas,
  listarCursos,
  responderPesquisa,
  resultadosPesquisa,
  transitionPesquisa,
  updatePesquisa,
} from "./pesquisas.service";
import type { PerguntaInput } from "./pesquisas.types";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(PesquisaCreateSchema, { body: req.body });
  const pesquisa = await createPesquisa(
    req.server.prisma,
    { ...body, perguntas: body.perguntas as PerguntaInput[] | undefined },
    viewer,
  );
  return reply.header("Location", pesquisaSelfHref(pesquisa.id)).code(201).send(toPesquisaResource(pesquisa, viewer));
}

export async function copy(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PesquisaCopySchema, { params: req.params, body: req.body });
  const pesquisa = await copyPesquisa(req.server.prisma, params.id, body, viewer);
  return reply.header("Location", pesquisaSelfHref(pesquisa.id)).code(201).send(toPesquisaResource(pesquisa, viewer));
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(PesquisaListSchema, { query: req.query });
  const q = { ...query, status: query.status as StatusPesquisa | undefined };
  const result = await listPesquisas(req.server.prisma, q, viewer);

  return reply.send(
    toCollection({
      rel: "surveys",
      basePath: SURVEYS,
      items: result.items.map((p) => toPesquisaResource(p, viewer)),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: { semestre: q.semestre, status: q.status },
      links: buildPesquisaCollectionLinks(viewer),
    }),
  );
}

export async function courses(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const cursos = await listarCursos(req.server.prisma, viewer);
  return reply.send(toResource({ cursos }, { self: { href: `${SURVEYS}/courses`, method: "GET" } }));
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  return reply.send(toPesquisaResource(await getPesquisa(req.server.prisma, params.id, viewer), viewer));
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PesquisaUpdateSchema, { params: req.params, body: req.body });
  const pesquisa = await updatePesquisa(
    req.server.prisma,
    params.id,
    { ...body, perguntas: body.perguntas as PerguntaInput[] | undefined },
    viewer,
  );
  return reply.send(toPesquisaResource(pesquisa, viewer));
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  await deletePesquisa(req.server.prisma, params.id, viewer);
  return reply.code(204).send();
}

export async function transition(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PesquisaStatusSchema, { params: req.params, body: req.body });
  const pesquisa = await transitionPesquisa(req.server.prisma, params.id, body.status as StatusPesquisa, viewer);
  return reply.send(toPesquisaResource(pesquisa, viewer));
}

export async function respond(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(PesquisaRespostaSchema, { params: req.params, body: req.body });
  const resultado = await responderPesquisa(req.server.prisma, params.id, body.respostas, viewer);
  return reply.code(201).send(toResource(resultado, { survey: { href: pesquisaSelfHref(params.id), method: "GET" } }));
}

export async function results(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, query } = parseOrThrow(PesquisaResultadosSchema, { params: req.params, query: req.query });
  const resultado = await resultadosPesquisa(req.server.prisma, params.id, query, viewer);
  return reply.send(
    toResource(resultado, {
      self: { href: `${pesquisaSelfHref(params.id)}/results`, method: "GET" },
      survey: { href: pesquisaSelfHref(params.id), method: "GET" },
    }),
  );
}
