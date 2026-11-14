import type { StatusChamado } from "@prisma/client";

/**
 * Como cada status aparece para as pessoas. Mesmos textos do TicketStatusBadge do frontend
 * (app/components/shared/TicketStatusBadge.tsx): se mudar lá, mude aqui.
 */
export const STATUS_LEGIVEL: Record<StatusChamado, string> = {
  ABERTO: "Solicitação recebida pela Fatec.",
  EM_ATENDIMENTO: "Em análise pelo setor responsável.",
  AGUARDANDO_USUARIO: "Aguardando documento ou resposta do aluno.",
  RESOLVIDO: "Solicitação respondida.",
  ENCERRADO: "Atendimento finalizado.",
};

/** Texto da notificação de mudança de status (#118), sem o código interno do status. */
export function textoMudancaStatus(rotuloChamado: string, status: StatusChamado): string {
  const texto = STATUS_LEGIVEL[status] ?? status;
  return `Chamado ${rotuloChamado}: ${texto.charAt(0).toLowerCase()}${texto.slice(1)}`;
}
