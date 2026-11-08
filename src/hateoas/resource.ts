import type { Links, Resource } from "./types";

/**
 * Junta os dados de um recurso com o seu `_links`.
 * Não filtra campos: quem chama deve passar só o que pode ser exposto (use `select` no Prisma).
 */
export function toResource<T extends object>(data: T, links: Links): Resource<T> {
  return { ...data, _links: links };
}