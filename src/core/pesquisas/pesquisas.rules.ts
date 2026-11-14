import type { Viewer } from "../../hateoas";
import { isAdmin, isStaff } from "../../hateoas";

/**
 * Regras da pesquisa institucional (CPA). Funcionalidade em beta.
 *
 * Uma pesquisa é uma edição por semestre. A CPA monta as perguntas (RASCUNHO),
 * abre para os alunos (ABERTA) e encerra (ENCERRADA). No semestre seguinte, copia
 * a edição anterior. As respostas são anônimas: ver `pesquisas.service.ts`.
 */

export type StatusPesquisa = "RASCUNHO" | "ABERTA" | "ENCERRADA";
export type TipoPergunta = "ESCALA" | "MULTIPLA" | "TEXTO";

export const STATUS_PESQUISA_VALUES: readonly StatusPesquisa[] = ["RASCUNHO", "ABERTA", "ENCERRADA"];
export const TIPO_PERGUNTA_VALUES: readonly TipoPergunta[] = ["ESCALA", "MULTIPLA", "TEXTO"];

/**
 * Mínimo de respostas para mostrar resultados de um recorte (pesquisa inteira ou
 * um curso). Abaixo disso, daria para deduzir quem respondeu o quê.
 */
export const PESQUISA_MIN_RESPOSTAS = 5;

/** Escala de 1 a 5; 0 = "não sei / não se aplica" (fica fora da média). */
export const ESCALA_MIN = 1;
export const ESCALA_MAX = 5;
export const ESCALA_NAO_SEI = 0;

export const CURSO_NAO_INFORMADO = "Curso não informado";

const TRANSITIONS: Record<StatusPesquisa, readonly StatusPesquisa[]> = {
  RASCUNHO: ["ABERTA"],
  ABERTA: ["ENCERRADA"],
  ENCERRADA: ["ABERTA"], // reabrir (ex.: prorrogar o prazo)
};

export interface PesquisaContext {
  status: StatusPesquisa;
  cursos: readonly string[] | null;
  fechaEm: Date | null;
}

/** Quem monta, abre e encerra pesquisas. Para mudar a regra, edite aqui. */
export function canManagePesquisa(viewer?: Viewer | null): boolean {
  return isAdmin(viewer);
}

/** Quem vê os resultados agregados: toda a equipe (CPA e coordenação). */
export function canViewResultados(viewer?: Viewer | null): boolean {
  return isStaff(viewer);
}

export function allowedTransitions(status: StatusPesquisa, viewer?: Viewer | null): readonly StatusPesquisa[] {
  return canManagePesquisa(viewer) ? TRANSITIONS[status] ?? [] : [];
}

/** Perguntas e público só mudam antes de abrir: depois, as respostas perderiam o sentido. */
export function canEditPesquisa(status: StatusPesquisa, viewer?: Viewer | null): boolean {
  return canManagePesquisa(viewer) && status === "RASCUNHO";
}

/** Aceita respostas agora? Status ABERTA e prazo (se houver) não vencido. */
export function aceitaRespostas(ctx: Pick<PesquisaContext, "status" | "fechaEm">, now: Date = new Date()): boolean {
  if (ctx.status !== "ABERTA") return false;
  return !ctx.fechaEm || ctx.fechaEm.getTime() > now.getTime();
}

/** O curso "oficial" do aluno: o do cadastro (cursoNome); senão, o que ele informou. */
export function cursoDoAluno(u: { cursoNome?: string | null; curso?: string | null }): string {
  return u.cursoNome?.trim() || u.curso?.trim() || CURSO_NAO_INFORMADO;
}

/** O aluno deste curso faz parte do público da pesquisa? `cursos` null = todos. */
export function cursoNoPublico(cursos: readonly string[] | null, curso: string): boolean {
  return !cursos || cursos.length === 0 || cursos.includes(curso);
}

/** Lê o JSON `cursos` do banco como lista de textos (ou null = todos). */
export function lerCursos(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  const lista = valor.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return lista.length ? lista : null;
}

export { proximoSemestre, semestreAtual, semestreValido } from "../../utils/semestre";
