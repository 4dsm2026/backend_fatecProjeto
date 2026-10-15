import { buildLinks, link, path, type Links, type Viewer } from "../../hateoas/index.js";

export interface NotificationRecord {
  id: string;
  usuarioId: string;
  titulo: string;
  mensagem: string;
  tipo: string;
  canal: string;
  criadoEm: Date;
  lidaEm: Date | null;
  arquivadaEm: Date | null;
  chamadoId: string | null;
  mensagemId?: string | null;
  anexoId?: string | null;
  organizacaoId?: string | null;
  erroEntrega?: string | null;
  meta?: unknown;
}

export function buildNotificationLinks(
  notification: NotificationRecord,
  _viewer?: Viewer,
  canViewTicket = true
): Links {
  const selfHref = path`/notifications/${notification.id}`;

  return buildLinks({
    self: link(selfHref, "GET"),
    "mark-read":
      notification.lidaEm === null &&
      link(selfHref, "PATCH", { title: "Marcar como lida" }),
    "mark-unread":
      notification.lidaEm !== null &&
      link(selfHref, "PATCH", { title: "Marcar como não lida" }),
    archive:
      notification.arquivadaEm === null &&
      link(selfHref, "PATCH", { title: "Arquivar" }),
    unarchive:
      notification.arquivadaEm !== null &&
      link(selfHref, "PATCH", { title: "Desarquivar" }),
    ticket:
      Boolean(notification.chamadoId) &&
      canViewTicket &&
      link(path`/tickets/${notification.chamadoId!}`, "GET", {
        title: "Ver chamado",
      }),
  });
}