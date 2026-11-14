import { buildLinks, link, path, toResource } from "../../hateoas";
import type { Links, Resource, Viewer } from "../../hateoas";
import {
  allowedTransitions,
  canArchiveTicket,
  canInteractWithTicket,
  canReopen,
  canUnarchiveTicket,
  canUpdateTicket,
  canViewTicket,
  isReopen,
} from "./ticket-rules";
import type { TicketContext, TicketStatus } from "./ticket-rules";

/** Os campos do chamado (vindos do Prisma) de que os links precisam. */
export interface TicketRow {
  id: string;
  status: TicketStatus;
  criadoPorId: string;
  encerradoEm: Date | null;
  arquivadoEm: Date | null;
}

export function toTicketContext(ticket: TicketRow): TicketContext {
  return {
    status: ticket.status,
    ownerId: ticket.criadoPorId,
    closedAt: ticket.encerradoEm,
    archivedAt: ticket.arquivadoEm,
  };
}

/** Monta o `_links` do chamado: cada link só existe se a regra permite ao papel e ao estado. */
export function buildTicketLinks(ticket: TicketRow, viewer: Viewer, now: Date = new Date()): Links {
  const ctx = toTicketContext(ticket);
  const self = path`/tickets/${ticket.id}`;
  const verMensagensEAnexos = canViewTicket(viewer, ctx.ownerId);
  const interagir = canInteractWithTicket(ctx, viewer);
  const transicoes = allowedTransitions(ctx, viewer, now).filter((to) => !isReopen(ctx.status, to));

  return buildLinks({
    self: link(self),
    collection: link("/tickets"),
    messages: verMensagensEAnexos && link(path`/tickets/${ticket.id}/messages`),
    attachments: verMensagensEAnexos && link(path`/tickets/${ticket.id}/attachments`),
    reply: interagir && link(path`/tickets/${ticket.id}/messages`, "POST"),
    upload: interagir && link(path`/tickets/${ticket.id}/attachments`, "POST"),
    update: canUpdateTicket(ctx, viewer) && link(self, "PATCH"),
    transition: transicoes.map((to) => link(self, "PATCH", { name: to })),
    reopen: canReopen(ctx, viewer, now) && link(self, "PATCH", { name: "EM_ATENDIMENTO" }),
    archive: canArchiveTicket(ctx, viewer) && link(self, "PATCH"),
    unarchive: canUnarchiveTicket(ctx, viewer) && link(self, "PATCH"),
  });
}

/** Devolve o chamado com os dados originais mais o `_links`. */
export function toTicketResource<T extends TicketRow>(ticket: T, viewer: Viewer, now: Date = new Date()): Resource<T> {
  return toResource(ticket, buildTicketLinks(ticket, viewer, now));
}