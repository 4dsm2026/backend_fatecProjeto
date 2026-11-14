/**
 * Espera uma tarefa "de apoio" (notificação, auditoria) e engole a falha, mas **não em silêncio**.
 *
 * Por que existe: antes, `notifyMany(...).catch(() => {})` e `prisma.auditoria.create(...).catch(() => {})`
 * rodavam sem `await`. Isso escondia o erro e deixava a escrita acontecer depois da resposta, o que
 * deixa os testes de integração instáveis (a notificação chegava no teste seguinte).
 *
 * Com `await bestEffort(...)` a escrita termina antes da resposta, e uma falha dela
 * continua sem derrubar a requisição principal, só que agora vai para o log.
 */
export async function bestEffort(label: string, work: PromiseLike<unknown> | undefined): Promise<void> {
  try {
    await work;
  } catch (error) {
    console.error(`[${label}] falha não-fatal (ignorada):`, error);
  }
}
