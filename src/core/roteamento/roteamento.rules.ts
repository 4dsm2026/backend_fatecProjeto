/**
 * Regras puras do roteamento de chamados (sem banco), para testar isoladas.
 */

export type NivelContato = "PRIMEIRO" | "SEGUNDO" | "COPIA";
export const NIVEIS: readonly NivelContato[] = ["PRIMEIRO", "SEGUNDO", "COPIA"];

export interface RegraLike {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  categoriaChave: string | null;
  servicoChave: string | null;
  setorId: string;
  setorCopiaId: string | null;
}

/**
 * A regra que vale para o chamado: só as ativas; a que casa pelo serviço vence a
 * que casa só pela categoria; empate, menor `ordem`. Regra sem serviço e sem
 * categoria não casa com nada (evita mandar tudo para um setor por engano).
 */
export function escolherRegra<R extends RegraLike>(
  regras: readonly R[],
  chamado: { servico?: string | null; categoria?: string | null },
): R | null {
  const candidatas = regras
    .filter((r) => r.ativo && (r.servicoChave || r.categoriaChave))
    .filter((r) => (!r.servicoChave || r.servicoChave === chamado.servico) && (!r.categoriaChave || r.categoriaChave === chamado.categoria))
    .sort((a, b) => Number(!!b.servicoChave) - Number(!!a.servicoChave) || a.ordem - b.ordem);
  return candidatas[0] ?? null;
}

const HORA_MS = 60 * 60 * 1000;

/**
 * Horas "úteis" entre duas datas: conta o tempo de segunda a sexta (24 h por dia) e
 * ignora sábados e domingos. Um chamado aberto na sexta à noite não escalona no fim
 * de semana.
 */
export function horasUteisEntre(inicio: Date, fim: Date): number {
  if (fim <= inicio) return 0;
  let total = 0;
  let cursor = new Date(inicio);
  while (cursor < fim) {
    const fimDoDia = new Date(cursor);
    fimDoDia.setHours(24, 0, 0, 0);
    const ate = fimDoDia < fim ? fimDoDia : fim;
    const dia = cursor.getDay();
    if (dia !== 0 && dia !== 6) total += ate.getTime() - cursor.getTime();
    cursor = ate;
  }
  return total / HORA_MS;
}

/** O chamado passou do prazo do setor sem ninguém assumir? */
export function deveEscalonar(
  chamado: { status: string; responsavelId: string | null; escalonadoEm: Date | null; criadoEm: Date },
  prazoHoras: number | null,
  agora: Date,
): boolean {
  if (prazoHoras == null || prazoHoras <= 0) return false;
  if (chamado.status !== "ABERTO" || chamado.responsavelId || chamado.escalonadoEm) return false;
  return horasUteisEntre(chamado.criadoEm, agora) >= prazoHoras;
}

const PROIBIDOS = new Set([" ", "\t", "\n", "\r", "<", ">", '"', ",", ";"]);

/** E-mail plausível: um @, parte local e domínio com ponto, sem espaços nem <>",; (sem regex). */
export function emailValido(email: string): boolean {
  if (email.length > 254 || [...email].some((ch) => PROIBIDOS.has(ch))) return false;
  const partes = email.split("@");
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  return local.length > 0 && dominio.includes(".") && !dominio.startsWith(".") && !dominio.endsWith(".");
}
