import type { Viewer } from "../../hateoas";
import { isStaff } from "../../hateoas";

/**
 * Trancamento e cancelamento de matrícula (beta). Regras do Regulamento Geral
 * dos Cursos de Graduação das Fatecs (Deliberação CEETEPS 106/2026):
 *  - até 2 trancamentos em cursos semestrais, consecutivos ou não;
 *  - cada trancamento vale por um semestre letivo;
 *  - não é concedido ao aluno do 1º semestre;
 *  - o cancelamento a pedido do aluno é definitivo.
 * A Secretaria decide. O sistema bloqueia só o que é certo (limite de
 * trancamentos registrados aqui, matrícula já cancelada) e AVISA o resto
 * (1º semestre), porque os dados acadêmicos do cadastro podem estar desatualizados.
 */

export type TipoSolicitacao = "TRANCAMENTO" | "CANCELAMENTO";
export type StatusSolicitacao = "SOLICITADO" | "EM_ANALISE" | "PENDENTE_ALUNO" | "DEFERIDO" | "INDEFERIDO" | "CANCELADO";

export const TIPO_VALUES: readonly TipoSolicitacao[] = ["TRANCAMENTO", "CANCELAMENTO"];
export const STATUS_VALUES: readonly StatusSolicitacao[] = ["SOLICITADO", "EM_ANALISE", "PENDENTE_ALUNO", "DEFERIDO", "INDEFERIDO", "CANCELADO"];
export const STATUS_FINAIS: readonly StatusSolicitacao[] = ["DEFERIDO", "INDEFERIDO", "CANCELADO"];
export const STATUS_ABERTOS: readonly StatusSolicitacao[] = STATUS_VALUES.filter((s) => !STATUS_FINAIS.includes(s));

export const MAX_TRANCAMENTOS = 2;

/** Motivos fixos, para a CPA e a coordenação enxergarem as causas de evasão. */
export const MOTIVOS = [
  "TRABALHO_HORARIO",
  "FINANCEIRO",
  "SAUDE",
  "FAMILIA",
  "MUDANCA_CIDADE",
  "TRANSPORTE",
  "DIFICULDADE_DISCIPLINAS",
  "NAO_SE_IDENTIFICOU",
  "TRANSFERENCIA",
  "OUTRO",
] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const MOTIVO_LEGIVEL: Record<Motivo, string> = {
  TRABALHO_HORARIO: "Trabalho ou horário",
  FINANCEIRO: "Dificuldade financeira",
  SAUDE: "Saúde",
  FAMILIA: "Questões familiares",
  MUDANCA_CIDADE: "Mudança de cidade",
  TRANSPORTE: "Transporte ou distância",
  DIFICULDADE_DISCIPLINAS: "Dificuldade com as disciplinas",
  NAO_SE_IDENTIFICOU: "Não se identificou com o curso",
  TRANSFERENCIA: "Transferência para outra instituição",
  OUTRO: "Outro",
};

export const STATUS_LEGIVEL: Record<StatusSolicitacao, string> = {
  SOLICITADO: "Pedido recebido pela Secretaria",
  EM_ANALISE: "Em análise pela Secretaria",
  PENDENTE_ALUNO: "A Secretaria precisa de uma resposta sua",
  DEFERIDO: "Pedido deferido",
  INDEFERIDO: "Pedido indeferido",
  CANCELADO: "Pedido retirado pelo aluno",
};

export const TIPO_LEGIVEL: Record<TipoSolicitacao, string> = {
  TRANCAMENTO: "Trancamento de matrícula",
  CANCELAMENTO: "Cancelamento de matrícula",
};

/** Valores de `Usuario.situacaoAcademica` que este fluxo escreve e o painel filtra. */
export const SITUACAO = { REGULAR: "Regular", TRANCADA: "Trancada", CANCELADA: "Cancelada" } as const;
export const SITUACOES = Object.values(SITUACAO);

/** Situação depois de um pedido deferido. */
export function situacaoAposDeferir(tipo: TipoSolicitacao): string {
  return tipo === "TRANCAMENTO" ? SITUACAO.TRANCADA : SITUACAO.CANCELADA;
}

export function situacaoNormalizada(s?: string | null): string {
  const t = s?.trim().toLowerCase() ?? "";
  if (t.startsWith("tranc")) return SITUACAO.TRANCADA;
  if (t.startsWith("cancel")) return SITUACAO.CANCELADA;
  return SITUACAO.REGULAR;
}

/** "1", "1º", "1º semestre" → 1. Sem número, null. */
export function numeroDoSemestre(s?: string | number | null): number | null {
  if (typeof s === "number") return Number.isInteger(s) ? s : null;
  const m = /\d+/.exec(s ?? "");
  return m ? Number(m[0]) : null;
}

export function isFinal(status: StatusSolicitacao): boolean {
  return STATUS_FINAIS.includes(status);
}

const STAFF_TRANSITIONS: Record<StatusSolicitacao, readonly StatusSolicitacao[]> = {
  SOLICITADO: ["EM_ANALISE", "PENDENTE_ALUNO", "DEFERIDO", "INDEFERIDO"],
  EM_ANALISE: ["PENDENTE_ALUNO", "DEFERIDO", "INDEFERIDO"],
  PENDENTE_ALUNO: ["EM_ANALISE", "INDEFERIDO"],
  DEFERIDO: [],
  INDEFERIDO: [],
  CANCELADO: [],
};

/** O aluno só desiste. A volta de PENDENTE_ALUNO acontece ao responder (link `update`). */
const OWNER_TRANSITIONS: Record<StatusSolicitacao, readonly StatusSolicitacao[]> = {
  SOLICITADO: ["CANCELADO"],
  EM_ANALISE: ["CANCELADO"],
  PENDENTE_ALUNO: ["CANCELADO"],
  DEFERIDO: [],
  INDEFERIDO: [],
  CANCELADO: [],
};

export interface SolicitacaoContext {
  status: StatusSolicitacao;
  ownerId: string;
}

const isOwner = (viewer: Viewer, ownerId: string) => viewer.id === ownerId;

export function canView(viewer: Viewer, ownerId: string): boolean {
  return isStaff(viewer) || isOwner(viewer, ownerId);
}

export function allowedTransitions(ctx: SolicitacaoContext, viewer: Viewer): readonly StatusSolicitacao[] {
  if (isStaff(viewer)) return STAFF_TRANSITIONS[ctx.status] ?? [];
  if (isOwner(viewer, ctx.ownerId)) return OWNER_TRANSITIONS[ctx.status] ?? [];
  return [];
}

/** Pedido de correção e indeferimento precisam explicar o motivo ao aluno. */
export function requiresComment(to: StatusSolicitacao): boolean {
  return to === "PENDENTE_ALUNO" || to === "INDEFERIDO";
}

/** O aluno responde a pendência (corrige a justificativa) só quando a Secretaria pediu. */
export function canRespond(ctx: SolicitacaoContext, viewer: Viewer): boolean {
  return isOwner(viewer, ctx.ownerId) && ctx.status === "PENDENTE_ALUNO";
}

export type AlunoParaPedido = {
  situacaoAcademica?: string | null;
  semestreAtual?: string | null;
};

/**
 * O que impede o aluno de abrir o pedido (bloqueio) e o que a Secretaria precisa
 * saber para decidir (alertas). `trancamentosDeferidos` conta só os registrados aqui.
 */
export function avaliarPedido(
  tipo: TipoSolicitacao,
  aluno: AlunoParaPedido,
  trancamentosDeferidos: number,
): { bloqueio: string | null; alertas: string[] } {
  const situacao = situacaoNormalizada(aluno.situacaoAcademica);
  const alertas: string[] = [];

  if (situacao === SITUACAO.CANCELADA) {
    return { bloqueio: "A matrícula já está cancelada.", alertas };
  }
  if (tipo === "TRANCAMENTO") {
    if (situacao === SITUACAO.TRANCADA) {
      return { bloqueio: "A matrícula já está trancada. Para voltar, faça a rematrícula no próximo período.", alertas };
    }
    if (trancamentosDeferidos >= MAX_TRANCAMENTOS) {
      return { bloqueio: `O limite de ${MAX_TRANCAMENTOS} trancamentos já foi usado.`, alertas };
    }
    if (numeroDoSemestre(aluno.semestreAtual) === 1) {
      alertas.push("O cadastro indica 1º semestre: pelo regulamento, o trancamento não é concedido no primeiro semestre.");
    }
    if (trancamentosDeferidos > 0) {
      alertas.push(`Já tem ${trancamentosDeferidos} trancamento(s) deferido(s) registrado(s); este seria o último permitido.`);
    }
  } else if (situacao === SITUACAO.TRANCADA) {
    alertas.push("A matrícula está trancada no momento.");
  }
  return { bloqueio: null, alertas };
}

const SEMESTRE_RE = /^(\d{4})-([12])$/;
export function semestreValido(s: string): boolean {
  return SEMESTRE_RE.test(s);
}
export function semestreAtual(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() < 6 ? 1 : 2}`;
}
export function proximoSemestre(semestre: string): string {
  const m = SEMESTRE_RE.exec(semestre);
  if (!m) return semestreAtual();
  const ano = Number(m[1]);
  return m[2] === "1" ? `${ano}-2` : `${ano + 1}-1`;
}
