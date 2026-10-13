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







export type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | readonly QueryScalar[] | undefined;

function isScalar(value: unknown): value is QueryScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Os pares `chave=valor` de um parâmetro: vazio não gera nada, lista repete a chave. */
function queryPairs(key: string, value: QueryValue): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((v) => v !== "")
    .map((v) => `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
}

/** Monta `basePath?a=1&b=2` com chaves em ordem alfabética, ignorando vazios. Listas repetem a chave. */
export function withQuery(basePath: string, params: Record<string, QueryValue>): string {
  const query = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key) => queryPairs(key, params[key]))
    .join("&");
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Do que veio na URL, guarda só os filtros permitidos, nos formatos que os links aceitam.
 * Serve para os links de paginação repetirem os mesmos filtros da busca.
 */
export function pickFilters(query: unknown, allowed: readonly string[]): Record<string, QueryValue> {
  if (typeof query !== "object" || query === null) return {};
  const source = query as Record<string, unknown>;
  const filters: Record<string, QueryValue> = {};
  for (const key of allowed) {
    const value = source[key];
    if (isScalar(value)) filters[key] = value;
    else if (Array.isArray(value) && value.every(isScalar)) filters[key] = value;
  }
  return filters;
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