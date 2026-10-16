import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, toResource, viewerFrom } from "../../hateoas";
import {
  ParamsWithIdSchema,
  SugestaoCreateSchema,
  SugestaoListSchema,
  SugestaoResponderSchema,
} from "../../validators/sugestoes";
import {
  buildSuggestionCollectionLinks,
  buildSuggestionLinks,
  suggestionSelfHref,
} from "./sugestoes.hateoas";
import {
  createSugestao,
  getSugestaoById,
  listSugestoes,
  responderSugestao,
} from "./sugestoes.service";

const SUGGESTIONS = "/sugestoes";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(SugestaoCreateSchema, { body: req.body });
  const suggestion = await createSugestao(req.server.prisma, body, { usuarioId: viewer.id });
  const resource = toResource(suggestion, buildSuggestionLinks(suggestion, viewer));

  return reply
    .header("Location", suggestionSelfHref(suggestion.id))
    .code(201)
    .send(resource);
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { query } = parseOrThrow(SugestaoListSchema, { query: req.query });
  const result = await listSugestoes(req.server.prisma, query, {
    usuarioId: viewer.id,
    role: viewer.role,
  });

  return reply.send(
    toCollection({
      rel: "suggestions",
      basePath: SUGGESTIONS,
      items: result.items.map((suggestion) =>
        toResource(suggestion, buildSuggestionLinks(suggestion, viewer)),
      ),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: { status: query.status },
      links: buildSuggestionCollectionLinks(viewer),
    }),
  );
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  const suggestion = await getSugestaoById(req.server.prisma, params.id, {
    usuarioId: viewer.id,
    role: viewer.role,
  });
  if (!suggestion) throw new ApiError("not-found", "Sugestão não encontrada");

  return reply.send(toResource(suggestion, buildSuggestionLinks(suggestion, viewer)));
}

export async function responder(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { params, body } = parseOrThrow(SugestaoResponderSchema, {
    params: req.params,
    body: req.body,
  });
  const suggestion = await responderSugestao(
    req.server.prisma,
    params.id,
    body,
    { staffId: viewer.id },
  );

  return reply.send(toResource(suggestion, buildSuggestionLinks(suggestion, viewer)));
}
