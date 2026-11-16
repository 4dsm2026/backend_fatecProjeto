import type { PrismaClient } from "@prisma/client";
import { escalonarAtrasados } from "../core/roteamento/roteamento.service";

const INTERVALO_MS = 15 * 60 * 1000;

/** Uma rodada do escalonamento. Nunca lança. */
export async function rodarEscalonamento(prisma: PrismaClient): Promise<void> {
  try {
    const r = await escalonarAtrasados(prisma);
    if (r.escalonados) console.info(`[roteamento] ${r.escalonados} chamado(s) escalonado(s) ao 2º nível`);
  } catch (e) {
    console.error("[roteamento] falha no escalonamento:", e instanceof Error ? e.message : String(e));
  }
}

/** Confere a cada 15 min os chamados parados além do prazo do setor. */
export function agendarEscalonamento(prisma: PrismaClient): void {
  setTimeout(() => void rodarEscalonamento(prisma), 60 * 1000).unref();
  setInterval(() => void rodarEscalonamento(prisma), INTERVALO_MS).unref();
}
