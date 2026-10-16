import { buildLinks, link } from "../../hateoas";
import type { Links } from "../../hateoas";

export function buildCatalogLinks(): Links {
  return buildLinks({
    self: link("/catalogo"),
  });
}
