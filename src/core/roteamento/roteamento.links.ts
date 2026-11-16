import { buildLinks, link, path } from "../../hateoas";
import type { Links } from "../../hateoas";

export const RULES = "/admin/routing-rules";

export function linksDaRegra(id: string): Links {
  return buildLinks({
    self: link(path`/admin/routing-rules/${id}`),
    update: link(path`/admin/routing-rules/${id}`, "PATCH"),
    delete: link(path`/admin/routing-rules/${id}`, "DELETE"),
  });
}

export function linksDasRegras(): Links {
  return buildLinks({
    self: link(RULES),
    create: link(RULES, "POST"),
    preview: link("/admin/routing-preview", "POST"),
  });
}

export function linksDaHierarquia(setorId: string): Links {
  return buildLinks({
    self: link(path`/admin/sectors/${setorId}/routing`),
    update: link(path`/admin/sectors/${setorId}/routing`, "PUT"),
    sector: link(path`/admin/sectors/${setorId}`),
  });
}
