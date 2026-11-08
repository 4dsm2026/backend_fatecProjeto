import { buildLinks, link, path, type Links, type Viewer, isAdmin, isStaff } from "../../hateoas/index.js";

export interface SetorRecord {
  id: string;
  nome: string;
  descricao?: string | null;
  organizacaoId?: string | null;
}

export function buildSectorLinks(sector: SetorRecord, viewer?: Viewer): Links {
  const selfHref = path`/admin/sectors/${sector.id}`;

  return buildLinks({
    self: link(selfHref, "GET"),
    collection: link("/admin/sectors", "GET"),
    update: isAdmin(viewer) && link(selfHref, "PATCH"),
    delete: isAdmin(viewer) && link(selfHref, "DELETE"),
    users: (isAdmin(viewer) || isStaff(viewer)) && link(path`/admin/sectors/${sector.id}/users`, "GET"),
  });
}