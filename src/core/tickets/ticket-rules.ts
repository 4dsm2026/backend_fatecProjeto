import { isStaff } from "../../hateoas";
import type { Role, Viewer } from "../../hateoas";


/** Mesmos valores do enum `StatusChamado` do Prisma (aqui sem depender do Prisma). */
export type TicketStatus =
    | "ABERTO"
    | "EM_ATENDIMENTO"
    | "AGUARDANDO_USUARIO"
    | "RESOLVIDO"
    | "ENCERRADO";

/** O que as regras precisam saber do chamado (vem de status, criadoPorId, encerradoEm e arquivadoEm). */
export interface TicketContext {
    status: TicketStatus;
    ownerId: string;
    closedAt: Date | null;
    archivedAt: Date | null;
}

/** Quem pode arquivar/desarquivar. Para mudar a regra de negócio, edite esta lista. */
const ARCHIVE_ROLES: readonly Role[] = ["ADMINISTRADOR"];

/** Em quais status o chamado pode ser arquivado. Tire status daqui para restringir. */
const ARCHIVABLE_STATUSES: readonly TicketStatus[] = [
    "ABERTO",
    "EM_ATENDIMENTO",
    "AGUARDANDO_USUARIO",
    "RESOLVIDO",
    "ENCERRADO",
];


/** Prazo, em dias, para reabrir um chamado depois de resolvido/encerrado. */
export const REOPEN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type TransitionTable = Record<TicketStatus, readonly TicketStatus[]>;

/** Para quais status a EQUIPE pode mudar, a partir de cada status. */
const STAFF_TRANSITIONS: TransitionTable = {
    ABERTO: ["EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"],
    EM_ATENDIMENTO: ["AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"],
    AGUARDANDO_USUARIO: ["EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"],
    RESOLVIDO: ["EM_ATENDIMENTO", "ENCERRADO"],
    ENCERRADO: ["EM_ATENDIMENTO"],
};

/** Para quais status o DONO (aluno) pode mudar. */
const OWNER_TRANSITIONS: TransitionTable = {
    ABERTO: [],
    EM_ATENDIMENTO: [],
    AGUARDANDO_USUARIO: [],
    RESOLVIDO: ["EM_ATENDIMENTO", "ENCERRADO"],
    ENCERRADO: ["EM_ATENDIMENTO"],
};

function isOwner(viewer: Viewer, ownerId: string): boolean {
    return viewer.id === ownerId;
}

/** Reabrir = sair de RESOLVIDO ou ENCERRADO de volta para EM_ATENDIMENTO. */
function isReopen(from: TicketStatus, to: TicketStatus): boolean {
    return (from === "RESOLVIDO" || from === "ENCERRADO") && to === "EM_ATENDIMENTO";
}

/** O prazo de reabertura conta a partir de `closedAt`. Sem data registrada, não dá para provar que venceu. */
function reopenWindowOpen(closedAt: Date | null, now: Date): boolean {
    if (!closedAt) return true;
    return now.getTime() - closedAt.getTime() <= REOPEN_WINDOW_DAYS * DAY_MS;
}

/** Quem pode ver o chamado: o dono e a equipe. */
export function canViewTicket(viewer: Viewer, ownerId: string): boolean {
    return isStaff(viewer) || isOwner(viewer, ownerId);
}

/** Para quais status quem pede pode mudar o chamado agora (já considerando o prazo de reabertura). */
export function allowedTransitions(ticket: TicketContext, viewer: Viewer, now: Date = new Date()): TicketStatus[] {
    if (ticket.archivedAt) return []; // arquivado é somente leitura
    const allowed = new Set<TicketStatus>();
    if (isStaff(viewer)) STAFF_TRANSITIONS[ticket.status].forEach((s) => allowed.add(s));
    if (isOwner(viewer, ticket.ownerId)) OWNER_TRANSITIONS[ticket.status].forEach((s) => allowed.add(s));

    const prazoAberto = reopenWindowOpen(ticket.closedAt, now);
    return [...allowed].filter((to) => !isReopen(ticket.status, to) || prazoAberto);
}

export function canTransition(ticket: TicketContext, to: TicketStatus, viewer: Viewer, now: Date = new Date()): boolean {
    return allowedTransitions(ticket, viewer, now).includes(to);
}

/** Botão "reabrir": chamado resolvido/encerrado, dentro do prazo, para dono ou equipe. */
export function canReopen(ticket: TicketContext, viewer: Viewer, now: Date = new Date()): boolean {
    return isReopen(ticket.status, "EM_ATENDIMENTO") && canTransition(ticket, "EM_ATENDIMENTO", viewer, now);
}

/** Responder ou anexar: dono e equipe, e só enquanto o chamado não está RESOLVIDO, ENCERRADO nem arquivado. */
export function canInteractWithTicket(ticket: TicketContext, viewer: Viewer): boolean {
    const fechado = ticket.status === "RESOLVIDO" || ticket.status === "ENCERRADO";
    return !fechado && !ticket.archivedAt && canViewTicket(viewer, ticket.ownerId);
}

/**
 * Status que o chamado assume depois de uma resposta, ou `undefined` se não muda.
 * Quando o dono responde em AGUARDANDO_USUARIO, volta para EM_ATENDIMENTO.
 */
export function statusAfterReply(ticket: TicketContext, viewer: Viewer): TicketStatus | undefined {
    if (ticket.status === "AGUARDANDO_USUARIO" && isOwner(viewer, ticket.ownerId)) return "EM_ATENDIMENTO";
    return undefined;
}


/** Arquivar: papel autorizado, status arquivável e chamado ainda não arquivado. */
export function canArchiveTicket(ticket: TicketContext, viewer: Viewer): boolean {
  return ARCHIVE_ROLES.includes(viewer.role) && ARCHIVABLE_STATUSES.includes(ticket.status) && !ticket.archivedAt;
}

/** Desarquivar: papel autorizado e chamado arquivado. */
export function canUnarchiveTicket(ticket: TicketContext, viewer: Viewer): boolean {
  return ARCHIVE_ROLES.includes(viewer.role) && !!ticket.archivedAt;
}