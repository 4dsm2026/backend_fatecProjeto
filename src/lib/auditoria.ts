import { prisma } from "./prisma";

function getLogger() {
  return (global as any).fastifyAppInstance?.log;
}

/**
 * Registra uma entrada de auditoria.
 * Nunca lança exceção — falhas de auditoria não devem derrubar o fluxo principal.
 */
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
}): Promise<void> {
  const logger = getLogger();
  try {
    await prisma.auditoria.create({
      data: { feitoPorId: feitoPorId ?? null, acao, alvo, meta },
    });
  } catch (error) {
    logger?.error({ error, acao, alvo }, "Erro ao registrar auditoria (não-fatal)");
  }
}
