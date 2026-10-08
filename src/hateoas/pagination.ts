import { z } from "zod";
import { buildLinks, link } from "./links";
import type { Collection, Links, PageInfo, Resource } from "./types";

/** Valida `?page=&size=` da URL. Base 0, tamanho padrão 20, máximo 100. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Converte página/tamanho nos argumentos `skip`/`take` do Prisma. */
export function toSkipTake({ page, size }: PaginationQuery): { skip: number; take: number } {
  return { skip: page * size, take: size };
}



export type QueryValue = string | number | boolean | undefined;

/** Monta `basePath?a=1&b=2` com chaves em ordem alfabética, ignorando vazios. */
export function withQuery(basePath: string, params: Record<string, QueryValue>): string {
  const query = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join("&");
  return query ? `${basePath}?${query}` : basePath;
}

/** Monta o bloco `page` da resposta. */
export function pageInfo(page: number, size: number, total: number): PageInfo {
  return { size, number: page, totalElements: total, totalPages: Math.ceil(total / size) };
}



/** Links de navegação: self, first, last sempre; prev e next só quando existem. */
export function paginationLinks(
  basePath: string,
  page: number,
  size: number,
  total: number,
  filters: Record<string, QueryValue> = {},
): Links {
  const lastPage = Math.max(Math.ceil(total / size) - 1, 0);
  const at = (n: number) => link(withQuery(basePath, { ...filters, page: n, size }));

  return buildLinks({
    self: at(page),
    first: at(0),
    last: at(lastPage),
    prev: page > 0 && at(Math.min(page - 1, lastPage)),
    next: page < lastPage && at(page + 1),
  });
}

export interface CollectionInput<T> {
  rel: string;
  basePath: string;
  items: Resource<T>[];
  page: number;
  size: number;
  total: number;
  filters?: Record<string, QueryValue>;
  links?: Links;
}

/** Monta a coleção HAL completa: itens, bloco `page` e links de navegação. */
export function toCollection<T>(input: CollectionInput<T>): Collection<T> {
  const { rel, basePath, items, page, size, total, filters = {}, links = {} } = input;
  return {
    _embedded: { [rel]: items },
    page: pageInfo(page, size, total),
    _links: { ...paginationLinks(basePath, page, size, total, filters), ...links },
  };
}