import type { PrismaClient } from "@prisma/client";
import { sincronizar } from "../core/mapa-salas/mapa-salas.service";

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const HORA = 6; // 06:00 do servidor
const ESPERA_NOVA_TENTATIVA_MS = 10 * 60 * 1000; // sites institucionais oscilam: tenta de novo 10 min depois

/**
 * Roda a atualização automática do mapa de salas, se estiver ligada. Nunca lança.
 * Devolve true se deu certo (publicou ou não havia mudança).
 */
export async function rodarSincronizacaoMapaSalas(prisma: PrismaClient): Promise<boolean> {
  const fonte = await prisma.mapaSalaFonte.findUnique({ where: { id: "padrao" }, select: { atualizacaoAutomatica: true, url: true, xpath: true } });
  if (!fonte?.atualizacaoAutomatica || !fonte.url || !fonte.xpath) return true;
  try {
    const r = await sincronizar(prisma, null);
    console.info(`[mapa-salas] ${r.resultado}`);
    return true;
  } catch (e) {
    const detalhe = e instanceof Error ? [e.message, (e as { detail?: string }).detail].filter(Boolean).join(": ") : String(e);
    console.error("[mapa-salas] falha na atualização automática:", detalhe);
    return false;
  }
}

/** Agenda a atualização diária às 06:00 (só Node, sem biblioteca de agendamento). */
export function agendarSincronizacaoMapaSalas(prisma: PrismaClient): void {
  const ate = () => {
    const agora = new Date();
    const prox = new Date(agora);
    prox.setHours(HORA, 0, 0, 0);
    if (prox <= agora) prox.setDate(prox.getDate() + 1);
    return prox.getTime() - agora.getTime();
  };
  const tick = () => {
    rodarSincronizacaoMapaSalas(prisma)
      .then((ok) => {
        if (!ok) setTimeout(() => void rodarSincronizacaoMapaSalas(prisma), ESPERA_NOVA_TENTATIVA_MS).unref();
      })
      .catch(() => {});
    setTimeout(tick, MS_POR_DIA).unref();
  };
  setTimeout(tick, ate()).unref();
}
