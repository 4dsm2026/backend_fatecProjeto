import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, toResource, viewerFrom } from "../../hateoas";
import {
  ParamsWithIdSchema,
  SolicitacaoCreateSchema,
  SolicitacaoListSchema,
  SolicitacaoRespostaSchema,
  SolicitacaoResumoSchema,
  SolicitacaoStatusSchema,
} from "../../validators/matricula";
import {
  ENROLLMENT_REQUESTS,
  buildSolicitacaoCollectionLinks,
  solicitacaoSelfHref,
  toSolicitacaoResource,
} from "./matricula.links";
import type { Motivo, StatusSolicitacao, TipoSolicitacao } from "./matricula.rules";
import {
  createSolicitacao,
  getSolicitacao,
  listSolicitacoes,
  responderPendencia,
  resumoSolicitacoes,
  situacaoDoAluno,
  transitionSolicitacao,
} from "./matricula.service";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(SolicitacaoCreateSchema, { body: req.body });
  const s = await createSolicitacao(
    req.server.prisma,
    { ...body, tipo: body.tipo as TipoSolicitacao, motivo: body.motivo as Motivo },
    viewer,
  );
  return reply.header("Location", solicitacaoSelfHref(s.id)).code(201).send(toSolicitacaoResource(s, viewer));
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(SolicitacaoListSchema, { query: req.query });
  const q = { ...query, status: query.status as StatusSolicitacao[] | undefined, tipo: query.tipo as TipoSolicitacao | undefined };
  const result = await listSolicitacoes(req.server.prisma, q, viewer);
  return reply.send(
    toCollection({
      rel: "enrollment-requests",
      basePath: ENROLLMENT_REQUESTS,
      items: result.items.map((s) => toSolicitacaoResource(s, viewer)),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: { status: q.status, tipo: q.tipo, semestre: q.semestre, curso: q.curso, usuarioId: q.usuarioId, abertos: q.abertos, search: q.search },
      links: buildSolicitacaoCollectionLinks(viewer),
    }),
  );
}

export async function eligibility(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  if (viewer.role !== "USUARIO") throw new ApiError("forbidden", "Somente para alunos");
  const situacao = await situacaoDoAluno(req.server.prisma, viewer);
  return reply.send(
    toResource(situacao, {
      self: { href: `${ENROLLMENT_REQUESTS}/eligibility`, method: "GET" },
      ...(situacao.podeTrancar || situacao.podeCancelar ? { create: { href: ENROLLMENT_REQUESTS, method: "POST" } } : {}),
    }),
  );
}

export async function summary(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(SolicitacaoResumoSchema, { query: req.query });
  const resumo = await resumoSolicitacoes(req.server.prisma, query, viewer);
  return reply.send(toResource(resumo, { self: { href: `${ENROLLMENT_REQUESTS}/summary`, method: "GET" } }));
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  return reply.send(toSolicitacaoResource(await getSolicitacao(req.server.prisma, params.id, viewer), viewer));
}

export async function respond(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(SolicitacaoRespostaSchema, { params: req.params, body: req.body });
  return reply.send(toSolicitacaoResource(await responderPendencia(req.server.prisma, params.id, body.justificativa, viewer), viewer));
}

export async function transition(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(SolicitacaoStatusSchema, { params: req.params, body: req.body });
  const s = await transitionSolicitacao(req.server.prisma, params.id, { ...body, status: body.status as StatusSolicitacao }, viewer);
  return reply.send(toSolicitacaoResource(s, viewer));
}
