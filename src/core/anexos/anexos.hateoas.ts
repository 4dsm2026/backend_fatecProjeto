import { buildLinks, link, path } from "../../hateoas";
import type { Links } from "../../hateoas";

export interface AnexoLinkRecord {
  id: string;
}

export function buildAnexoLinks(
  anexo: AnexoLinkRecord,
  ticketId: string,
  downloadAllowed = true,
): Links {
  return buildLinks({
    self: link(path`/attachments/${anexo.id}`),
    content: downloadAllowed && link(path`/attachments/${anexo.id}/content`),
    collection: link(path`/tickets/${ticketId}/attachments`),
  });
}
