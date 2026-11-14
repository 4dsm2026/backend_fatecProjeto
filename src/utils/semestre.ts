/** Semestre letivo no formato "AAAA-1" / "AAAA-2" (Pesquisa CPA, trancamento). */
const SEMESTRE_RE = /^(\d{4})-([12])$/;

export function semestreValido(s: string): boolean {
  return SEMESTRE_RE.test(s);
}

/** "2026-2" para datas de julho a dezembro; "2026-1" de janeiro a junho. */
export function semestreAtual(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() < 6 ? 1 : 2}`;
}

export function proximoSemestre(semestre: string): string {
  const m = SEMESTRE_RE.exec(semestre);
  if (!m) return semestreAtual();
  const ano = Number(m[1]);
  return m[2] === "1" ? `${ano}-2` : `${ano + 1}-1`;
}
