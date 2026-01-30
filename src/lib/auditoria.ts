import { prisma } from "./prisma";

function getLogger() {
  return (global as any).fastifyAppInstance?.log;
}

export async function registrarAuditoria({
  feitoPorId,
  acao,
  alvo = null,
  meta = null,
}: {
  feitoPorId?: string | null;
  acao: string;
  alvo?: string | null;
  meta?: any;
}) {
  const logger = getLogger();
  try {
    logger?.info({ acao, feitoPorId, alvo, meta }, "Registrando auditoria");

    const result = await prisma.auditoria.create({
      data: {
        feitoPorId: feitoPorId || null,
        acao,
        alvo,
        meta,
      },
    });

    logger?.info({ id: result.id }, "Auditoria registrada");
    return result;
  } catch (error) {
    logger?.error({ error }, "Erro ao registrar auditoria");
    throw error;
  }
}
