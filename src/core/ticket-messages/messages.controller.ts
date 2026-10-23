import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import {
  ApiError,
  parseOrThrow,
  path,
  pickFilters,
  toCollection,
  viewerFrom,
} from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { alunoSemAcessoAoChamado, updateTicket } from "../tickets/tickets.service";
import { toTicketContext } from "../tickets/tickets.links";
import { canInteractWithTicket, statusAfterReply } from "../tickets/ticket-rules";
import type { TicketContext } from "../tickets/ticket-rules";
import {
  CreateMessageSchema,
  GetMessageSchema,
  ListMessagesSchema,
} from "./messages.types";
import {
  createTicketMessage,
  getTicketMessage,
  listTicketMessages,
} from "./messages.service";
import { toMessageResource } from "./messages.links";

function requireViewer(req: FastifyRequest): Viewer {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

/** Aluno que não é dono: mesma resposta 404 do chamado inexistente (não vaza existência). */
async function assertCanSeeTicket(prisma: PrismaClient, id: string, viewer: Viewer): Promise<void> {
  const semAcesso = await alunoSemAcessoAoChamado(prisma, id, { sub: viewer.id, role: viewer.role });
  if (semAcesso) throw new ApiError("not-found", "Chamado não encontrado");
}

async function loadTicketContext(prisma: PrismaClient, id: string): Promise<TicketContext> {
  const row = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } });
  if (!row) throw new ApiError("not-found", "Chamado não encontrado");
  return toTicketContext(row);
}

/* POST /tickets/:id/messages */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const { params, body } = parseOrThrow(CreateMessageSchema, { params: req.params, body: req.body });
  const viewer = requireViewer(req);
  const prisma = req.server.prisma;

  await assertCanSeeTicket(prisma, params.id, viewer);
  const ticket = await loadTicketContext(prisma, params.id);

  if (!canInteractWithTicket(ticket, viewer)) {
    throw new ApiError(
      "conflict",
      "Ação não permitida",
      "O chamado não aceita novas mensagens: está resolvido, encerrado ou arquivado.",
    );
  }

  const created = await createTicketMessage(prisma, params.id, viewer.id, body.conteudo);

  // Dono respondeu em AGUARDANDO_USUARIO: o chamado volta para EM_ATENDIMENTO (com histórico e notificação).
  const novoStatus = statusAfterReply(ticket, viewer);
  if (novoStatus) await updateTicket(prisma, params.id, { status: novoStatus }, { feitoPorId: viewer.id });

  return res
    .header("Location", path`/tickets/${params.id}/messages/${created.id}`)
    .code(201)
    .send(toMessageResource(created, params.id));
}

/* GET /tickets/:id/messages */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const { params, query } = parseOrThrow(ListMessagesSchema, { params: req.params, query: req.query });
  const viewer = requireViewer(req);
  const prisma = req.server.prisma;

  await assertCanSeeTicket(prisma, params.id, viewer);

  const result = await listTicketMessages(prisma, params.id, query);

  return res.send(
    toCollection({
      rel: "messages",
      basePath: path`/tickets/${params.id}/messages`,
      items: result.mensagens.map((m) => toMessageResource(m, params.id)),
      page: result.page,
      size: result.size,
      total: result.total,
      filters: pickFilters(req.query, ["orderDir"]),
    }),
  );
}

/* GET /tickets/:id/messages/:messageId */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const { params } = parseOrThrow(GetMessageSchema, { params: req.params });
  const viewer = requireViewer(req);
  const prisma = req.server.prisma;

  await assertCanSeeTicket(prisma, params.id, viewer);

  const message = await getTicketMessage(prisma, params.id, params.messageId);
  if (!message) throw new ApiError("not-found", "Mensagem não encontrada");

  return res.send(toMessageResource(message, params.id));
}