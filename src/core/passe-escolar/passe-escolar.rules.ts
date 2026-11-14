import type { Viewer } from "../../hateoas";
import { isStaff } from "../../hateoas";

/**
 * Regras do Passe Escolar (EMTU/ARTESP). Funcionalidade em beta.
 *
 * O processo real tem três partes: o aluno pede à Fatec, a Fatec lança os dados do
 * aluno no Portal de Relacionamento da ARTESP/EMTU e, só depois, o aluno preenche o
 * formulário no site da EMTU, paga o boleto e envia os documentos direto para a EMTU.
 * A Fatec não vê o lado da EMTU, então as etapas de lá são informadas pelo aluno.
 */

/** Mesmos valores do enum `StatusPasseEscolar` do Prisma (aqui sem depender do Prisma). */
export type StatusPasseEscolar =
  | "SOLICITADO"
  | "PENDENTE_ALUNO"
  | "CADASTRADO_PORTAL"
  | "REQUISITADO_EMTU"
  | "CONCLUIDO"
  | "INDEFERIDO"
  | "CANCELADO";

export const STATUS_PASSE_VALUES: readonly StatusPasseEscolar[] = [
  "SOLICITADO",
  "PENDENTE_ALUNO",
  "CADASTRADO_PORTAL",
  "REQUISITADO_EMTU",
  "CONCLUIDO",
  "INDEFERIDO",
  "CANCELADO",
];

/** Status em que o pedido já acabou: não aceita mais mudanças nem edição. */
export const STATUS_FINAIS: readonly StatusPasseEscolar[] = ["CONCLUIDO", "INDEFERIDO", "CANCELADO"];

/** Status "em andamento" (o que a secretaria e o aluno precisam acompanhar). */
export const STATUS_ATIVOS: readonly StatusPasseEscolar[] = STATUS_PASSE_VALUES.filter(
  (s) => !STATUS_FINAIS.includes(s),
);

export interface PasseContext {
  status: StatusPasseEscolar;
  ownerId: string;
}

type TransitionTable = Record<StatusPasseEscolar, readonly StatusPasseEscolar[]>;

/** Para quais status a EQUIPE (secretaria) pode mudar, a partir de cada status. */
const STAFF_TRANSITIONS: TransitionTable = {
  SOLICITADO: ["CADASTRADO_PORTAL", "PENDENTE_ALUNO", "INDEFERIDO"],
  PENDENTE_ALUNO: ["CADASTRADO_PORTAL", "INDEFERIDO", "CANCELADO"],
  CADASTRADO_PORTAL: ["REQUISITADO_EMTU", "CONCLUIDO", "CANCELADO"],
  REQUISITADO_EMTU: ["CONCLUIDO", "INDEFERIDO", "CANCELADO"],
  CONCLUIDO: ["CANCELADO"], // aluno saiu da Fatec: a secretaria exclui do portal
  INDEFERIDO: [],
  CANCELADO: [],
};

/**
 * Para quais status o DONO (aluno) pode mudar. A volta de PENDENTE_ALUNO para
 * SOLICITADO não está aqui de propósito: ela acontece ao corrigir os dados (link `update`).
 */
const OWNER_TRANSITIONS: TransitionTable = {
  SOLICITADO: ["CANCELADO"],
  PENDENTE_ALUNO: ["CANCELADO"],
  CADASTRADO_PORTAL: ["REQUISITADO_EMTU", "CANCELADO"],
  REQUISITADO_EMTU: ["CONCLUIDO", "INDEFERIDO"],
  CONCLUIDO: [],
  INDEFERIDO: [],
  CANCELADO: [],
};

/** Status que exigem explicação para o aluno. */
const COMENTARIO_OBRIGATORIO: readonly StatusPasseEscolar[] = ["PENDENTE_ALUNO", "INDEFERIDO"];

function isOwner(viewer: Viewer, ownerId: string): boolean {
  return viewer.id === ownerId;
}

export function isFinal(status: StatusPasseEscolar): boolean {
  return STATUS_FINAIS.includes(status);
}

/** Quem pode ver o pedido: o dono e a equipe. */
export function canViewPasse(viewer: Viewer, ownerId: string): boolean {
  return isStaff(viewer) || isOwner(viewer, ownerId);
}

/** O aluno corrige os próprios dados enquanto a Fatec ainda não lançou no portal. */
export function canUpdatePasse(ctx: PasseContext, viewer: Viewer): boolean {
  if (!isOwner(viewer, ctx.ownerId)) return false;
  return ctx.status === "SOLICITADO" || ctx.status === "PENDENTE_ALUNO";
}

/** Transições permitidas a quem olha, no estado atual. */
export function allowedTransitions(ctx: PasseContext, viewer: Viewer): readonly StatusPasseEscolar[] {
  if (isStaff(viewer)) return STAFF_TRANSITIONS[ctx.status] ?? [];
  if (isOwner(viewer, ctx.ownerId)) return OWNER_TRANSITIONS[ctx.status] ?? [];
  return [];
}

export function canTransition(ctx: PasseContext, viewer: Viewer, to: StatusPasseEscolar): boolean {
  return allowedTransitions(ctx, viewer).includes(to);
}

/** Pendência e indeferimento precisam dizer o motivo. */
export function requiresComment(to: StatusPasseEscolar): boolean {
  return COMENTARIO_OBRIGATORIO.includes(to);
}

/** O que cada etapa significa, nas palavras que o aluno lê. */
export const STATUS_PASSE_LEGIVEL: Record<StatusPasseEscolar, string> = {
  SOLICITADO: "Pedido recebido pela Fatec",
  PENDENTE_ALUNO: "A Fatec precisa de uma correção sua",
  CADASTRADO_PORTAL: "Cadastrado no portal da EMTU: agora é a sua vez",
  REQUISITADO_EMTU: "Formulário enviado à EMTU, em análise",
  CONCLUIDO: "Passe aprovado pela EMTU",
  INDEFERIDO: "Pedido recusado",
  CANCELADO: "Pedido cancelado",
};
