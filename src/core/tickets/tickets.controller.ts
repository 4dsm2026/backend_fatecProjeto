import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { sendNotFound, sendUnauthorized, sendValidationError } from "../../utils/http";
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
  softDeleteTicket,
  statsTickets,
} from "./tickets.service";
import type { TicketsListQuery } from "./tickets.types";
import { ApiError, isStaff, path, pickFilters, toCollection } from "../../hateoas";
import type { Role, Viewer } from "../../hateoas";
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

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const createValidator = buildRouteValidator({ body: TicketCreateSchema.shape.body });
const listValidator   = buildRouteValidator({ query: TicketListSchema.shape.query });
const idValidator     = buildRouteValidator({ params: ParamsWithIdSchema.shape.params });
// Filtros da URL que os links de paginação repetem (tudo da busca, menos page e size).
const LIST_FILTER_KEYS = Object.keys(TicketListSchema.shape.query.shape).filter(
  (k) => k !== "page" && k !== "size",
);
const updateValidator = buildRouteValidator({
  params: TicketUpdateSchema.shape.params,
  body:   TicketUpdateSchema.shape.body,
});

async function requireAuthUser(req: FastifyRequest, res: FastifyReply) {
  const authUser = req.user as { sub: string; role: string } | undefined;
  if (!authUser) {
    await res.code(401).send({ error: "Não autenticado" });
    return null;
  }

  return authUser;
}

async function denyMissingTicketAccess(
  prisma: any,
  id: string,
  authUser: { sub: string; role: string } | undefined,
  res: FastifyReply,
) {
  if (await alunoSemAcessoAoChamado(prisma, id, authUser)) {
    await res.code(404).send({ error: "Chamado não encontrado" });
    return true;
  }

  return false;
}

/* ============ POST /tickets ============ */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const authUser = await requireAuthUser(req, res);
  if (!authUser) return;

  const feitoPorId = authUser.sub;

    try {
    const ticket = await createTicket(prisma, parsed.data!.body!, { feitoPorId });
    if (!ticket) throw new Error("Chamado criado não foi encontrado");

    const viewer = { id: feitoPorId, role: authUser.role as Role };
    await res
      .header("Location", path`/tickets/${ticket.id}`)
      .code(201)
      .send(toTicketResource(ticket, viewer));
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ GET /tickets/:id ============ */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const authUser = await requireAuthUser(req, res);
  if (!authUser) return;
  try {
    const id = parsed.data!.params!.id;

    // Chamado inexistente ou de outro aluno: mesma resposta 404 (não vaza existência).
    if (await denyMissingTicketAccess(prisma, id, authUser, res)) return;

    const ticket = await getTicketById(prisma, id, [
      "cliente", "contrato", "servico", "setor", "responsavel", "criadoPor", "historico",
    ]);

     if (!ticket)
      return sendNotFound(res, "Chamado");

    const viewer = { id: authUser.sub, role: authUser.role as Role };
    await res.send(toTicketResource(ticket, viewer));

    
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao buscar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ GET /tickets ============ */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma = req.server.prisma;
  const authUser = await requireAuthUser(req, res);
  if (!authUser) return;

  try {
    const q = parsed.data!.query!;
    const isAluno = authUser.role === "USUARIO";

    const query: TicketsListQuery = {
      ...q,
      criadoPorId: isAluno ? authUser.sub : q.criadoPorId,
    };

        const result = await listTickets(prisma, query);
    const viewer = { id: authUser.sub, role: authUser.role as Role };

    await res.send(
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
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar tickets");
    await res.code(500).send({ error: "Erro interno ao listar tickets" });
  }
}

/* ============ GET /tickets/stats ============ */
export async function stats(req: FastifyRequest, res: FastifyReply) {
  const prisma   = req.server.prisma;
  const authUser = await requireAuthUser(req, res);
  if (!authUser) return;

  try {
    const organizacaoId = (req.query as any)?.organizacaoId as string | undefined;
    const result = await statsTickets(prisma, { organizacaoId });
    await res.send(result);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao computar stats de tickets");
    await res.code(500).send({ error: errMsg(e) });
  }
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
  const parsed = updateValidator.parse(req);
  if ("error" in parsed) return sendValidationError(res, parsed.error);

  const prisma     = req.server.prisma;
  const authUser   = await requireAuthUser(req, res);
  if (!authUser) return;
  const feitoPorId = authUser.sub;

   try {
    const id = parsed.data!.params!.id;
    const body = parsed.data!.body!;

    if (await denyMissingTicketAccess(prisma, id, authUser, res)) return;

    const viewer = { id: authUser.sub, role: authUser.role as Role };
    const current = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } });
    if (!current) return sendNotFound(res, "Chamado");

    assertPatchAllowed(toTicketContext(current), viewer, body);

    const ticket = await updateTicket(prisma, id, body, { feitoPorId });
    await res.send(toTicketResource(ticket, viewer));
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.code === "P2025")
      return sendNotFound(res, "Chamado");
    req.log.error({ e }, "💥 Erro ao atualizar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ DELETE /tickets/:id (soft) ============ */
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
