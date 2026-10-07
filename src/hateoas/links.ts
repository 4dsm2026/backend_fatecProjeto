import type { HttpMethod, Link, Links, Role, Viewer } from "./types";

const STAFF_ROLES: readonly Role[] = ["BACKOFFICE", "TECNICO", "ADMINISTRADOR"];

/** Equipe de atendimento: BACKOFFICE, TECNICO ou ADMINISTRADOR. */
export function isStaff(viewer: Viewer): boolean {
  return STAFF_ROLES.includes(viewer.role);
}

export function isAdmin(viewer: Viewer): boolean {
  return viewer.role === "ADMINISTRADOR";
}

/**
 * Template tag que codifica (encodeURIComponent) cada valor interpolado.
 * Uso: path`/tickets/${id}/messages`
 * Evita montar URL com concatenação e impede path traversal ("../").
 */
export function path(strings: TemplateStringsArray, ...values: ReadonlyArray<string | number>): string {
  return strings.reduce(
    (acc, text, i) => acc + text + (i < values.length ? encodeURIComponent(String(values[i])) : ""),
    "",
  );
}

/** Cria um link. O método padrão é GET. */
export function link(
  href: string,
  method: HttpMethod = "GET",
  extra: { title?: string; name?: string } = {},
): Link {
  return { href, method, ...extra };
}

/** O que `buildLinks` aceita por `rel`: um link, vários, ou "nada" (false/null/undefined). */
export type LinkEntry = Link | readonly Link[] | false | null | undefined;

/**
 * Monta o `_links` descartando o que não vale.
 * É AQUI que "só entra o link que estado e papel permitem":
 *   buildLinks({ reply: podeResponder && link(...) })
 * Se `podeResponder` for false, o `rel` simplesmente não aparece.
 */
export function buildLinks(entries: Record<string, LinkEntry>): Links {
  const result: Links = {};
  for (const [rel, entry] of Object.entries(entries)) {
    if (!entry) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    result[rel] = entry;
  }
  return result;
}
