import type { PrismaClient } from "@prisma/client";
import { sincronizar } from "../core/mapa-salas/mapa-salas.service";

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const HORA = 6; // 06:00 do servidor

/** Roda a atualização automática do mapa de salas, se estiver ligada. Nunca lança. */
export async function rodarSincronizacaoMapaSalas(prisma: PrismaClient): Promise<void> {
  const fonte = await prisma.mapaSalaFonte.findUnique({ where: { id: "padrao" }, select: { atualizacaoAutomatica: true, url: true, xpath: true } });
  if (!fonte?.atualizacaoAutomatica || !fonte.url || !fonte.xpath) return;
  try {
    const r = await sincronizar(prisma, null);
    console.info(`[mapa-salas] ${r.resultado}`);
  } catch (e) {
    console.error("[mapa-salas] falha na atualização automática:", e instanceof Error ? e.message : e);
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
    rodarSincronizacaoMapaSalas(prisma).catch(() => {});
    setTimeout(tick, MS_POR_DIA).unref();
  };
  setTimeout(tick, ate()).unref();
}
