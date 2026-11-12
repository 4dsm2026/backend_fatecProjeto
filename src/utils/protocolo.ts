/**
 * Como um chamado aparece em textos para o usuário (notificações, e-mails).
 * Nunca usa o id interno do banco: chamados antigos sem protocolo aparecem como "sem protocolo".
 * Para gerar protocolo para eles: pnpm backfill:protocolos
 */
export function rotuloChamado(protocolo?: string | null): string {
  return protocolo?.trim() || "sem protocolo";
}
