import { buildLinks, link, path, toResource } from "../../hateoas";

/**
 * Mensagem como recurso HAL. A mensagem não tem ações próprias (ninguém edita nem
 * apaga): os links levam a ela mesma, à conversa e ao chamado dono.
 */
export function toMessageResource<T extends { id: string }>(message: T, ticketId: string) {
  return toResource(
    message,
    buildLinks({
      self: link(path`/tickets/${ticketId}/messages/${message.id}`),
      collection: link(path`/tickets/${ticketId}/messages`),
      ticket: link(path`/tickets/${ticketId}`),
    }),
  );
}