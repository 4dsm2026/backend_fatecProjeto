import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  TicketCreateSchema,
  TicketListSchema,
  TicketUpdateSchema,
  ParamsWithIdSchema,
} from "../../validators/tickets";
import {
  createTicket,
  getTicketById,
  alunoSemAcessoAoChamado,
  listTickets,
  updateTicket,
  statsTickets,
} from "./tickets.service";
import type { TicketsListQuery } from "./tickets.types";
import {
  ApiError,
  buildLinks,
  isStaff,
  link,
  parseOrThrow,
  path,
  pickFilters,
  toCollection,
  toResource,
  viewerFrom,
} from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { toTicketContext, toTicketResource } from "./tickets.links";
import {
  canArchiveTicket,
  canTransition,
  canUnarchiveTicket,
  canUpdateTicket,
  isReopen,
  REOPEN_WINDOW_DAYS,
} from "./ticket-rules";
import type { TicketContext, TicketStatus } from "./ticket-rules";

// Filtros da URL que os links de paginação repetem (tudo da busca, menos page e size).
const LIST_FILTER_KEYS = Object.keys(TicketListSchema.shape.query.shape).filter(
  (k) => k !== "page" && k !== "size",
);

const StatsQuerySchema = z.object({
  query: z.object({ organizacaoId: z.string().optional() }),
});

function requireViewer(req: FastifyRequest): Viewer {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

/** Chamado de outro aluno: mesma resposta 404 do chamado inexistente (não vaza existência). */
async function assertCanSeeTicket(prisma: PrismaClient, id: string, viewer: Viewer): Promise<void> {
  const semAcesso = await alunoSemAcessoAoChamado(prisma, id, { sub: viewer.id, role: viewer.role });
  if (semAcesso) throw new ApiError("not-found", "Chamado não encontrado");
}

/* ============ POST /tickets ============ */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const { body } = parseOrThrow(TicketCreateSchema, { body: req.body });
  const viewer = requireViewer(req);

  const ticket = await createTicket(req.server.prisma, body, { feitoPorId: viewer.id });
  if (!ticket) throw new ApiError("internal", "Erro interno do servidor");

  return res
    .header("Location", path`/tickets/${ticket.id}`)
    .code(201)
    .send(toTicketResource(ticket, viewer));
}

/* ============ GET /tickets/:id ============ */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const { params } = parseOrThrow(ParamsWithIdSchema, { params: req.params });
  const viewer = requireViewer(req);
  const prisma = req.server.prisma;

  await assertCanSeeTicket(prisma, params.id, viewer);

  const ticket = await getTicketById(prisma, params.id, [
    "cliente", "contrato", "servico", "setor", "responsavel", "criadoPor", "historico",
  ]);
  if (!ticket) throw new ApiError("not-found", "Chamado não encontrado");

  return res.send(toTicketResource(ticket, viewer));
}

/* ============ GET /tickets ============ */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const { query } = parseOrThrow(TicketListSchema, { query: req.query });
  const viewer = requireViewer(req);

  const filters: TicketsListQuery = {
    ...query,
    criadoPorId: viewer.role === "USUARIO" ? viewer.id : query.criadoPorId,
  };
  const result = await listTickets(req.server.prisma, filters);

  return res.send(
    toCollection({
      rel: "tickets",
      basePath: "/tickets",
      items: result.items.map((t) => toTicketResource(t, viewer)),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: pickFilters(req.query, LIST_FILTER_KEYS),
    }),
  );
}

/* ============ GET /tickets/stats ============ */
export async function stats(req: FastifyRequest, res: FastifyReply) {
  requireViewer(req);
  const { query } = parseOrThrow(StatsQuerySchema, { query: req.query });

  const result = await statsTickets(req.server.prisma, { organizacaoId: query.organizacaoId });
  return res.send(toResource(result, buildLinks({ self: link("/ticket-stats") })));
}

type PatchBody = { status?: TicketStatus; arquivado?: boolean; [campo: string]: unknown };

/** Bloqueio: a equipe recebe 409 (o estado não permite); os demais, 403 (sem permissão). */
function blocked(viewer: Viewer, detail: string): ApiError {
  return new ApiError(isStaff(viewer) ? "conflict" : "forbidden", "Ação não permitida", detail);
}

function assertFieldsAllowed(ctx: TicketContext, viewer: Viewer, hasFields: boolean): void {
  if (!hasFields || canUpdateTicket(ctx, viewer)) return;
  throw blocked(viewer, "Os dados do chamado só podem ser editados pela equipe, e não em chamado encerrado ou arquivado.");
}

function assertStatusAllowed(ctx: TicketContext, viewer: Viewer, to: TicketStatus | undefined): void {
  if (!to || to === ctx.status || canTransition(ctx, to, viewer)) return;
  if (ctx.archivedAt) throw new ApiError("conflict", "Ação não permitida", "O chamado está arquivado (somente leitura).");
  if (isReopen(ctx.status, to)) {
    throw new ApiError("conflict", "Ação não permitida", `O prazo de ${REOPEN_WINDOW_DAYS} dias para reabrir o chamado terminou.`);
  }
  throw blocked(viewer, `Não é possível mudar o chamado de ${ctx.status} para ${to}.`);
}

function assertArchiveAllowed(ctx: TicketContext, viewer: Viewer, arquivado: boolean | undefined): void {
  if (arquivado === true && !canArchiveTicket(ctx, viewer)) {
    throw ctx.archivedAt
      ? new ApiError("conflict", "Ação não permitida", "O chamado já está arquivado.")
      : new ApiError("forbidden", "Ação não permitida", "Só o administrador arquiva chamados.");
  }
  if (arquivado === false && !canUnarchiveTicket(ctx, viewer)) {
    throw ctx.archivedAt
      ? new ApiError("forbidden", "Ação não permitida", "Só o administrador desarquiva chamados.")
      : new ApiError("conflict", "Ação não permitida", "O chamado não está arquivado.");
  }
}

function assertPatchAllowed(ctx: TicketContext, viewer: Viewer, body: PatchBody): void {
  const { status, arquivado, ...fields } = body;
  assertFieldsAllowed(ctx, viewer, Object.keys(fields).length > 0);
  assertStatusAllowed(ctx, viewer, status);
  assertArchiveAllowed(ctx, viewer, arquivado);
}

/* ============ PATCH /tickets/:id ============ */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const { params, body } = parseOrThrow(TicketUpdateSchema, { params: req.params, body: req.body });
  const viewer = requireViewer(req);
  const prisma = req.server.prisma;

  await assertCanSeeTicket(prisma, params.id, viewer);

  const current = await prisma.chamado.findFirst({ where: { id: params.id, deletadoEm: null } });
  if (!current) throw new ApiError("not-found", "Chamado não encontrado");

  assertPatchAllowed(toTicketContext(current), viewer, body);

  const ticket = await updateTicket(prisma, params.id, body, { feitoPorId: viewer.id });
  return res.send(toTicketResource(ticket, viewer));
}



/* ============ DELETE /tickets/:id (soft) ============ */
/*

export async function removeSoft(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma     = req.server.prisma;
  const authUser   = await requireAuthUser(req, res);
  if (!authUser) return;
  const feitoPorId = authUser.sub;

  try {
    const id = parsed.data!.params!.id;

    if (await denyMissingTicketAccess(prisma, id, authUser, res)) return;

    const ticket = await softDeleteTicket(
      prisma,
      id,
      { feitoPorId },
    );
    await res.send(ticket);
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendNotFound(res, "Chamado");
    req.log.error({ e }, "💥 Erro ao remover (soft) ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}
*/