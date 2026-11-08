import { buildLinks, link, path, type Links, type Viewer, isAdmin, isStaff } from "../../hateoas/index.js";

export interface UsuarioSetorRecord {
  id: string;
  usuarioId: string;
  setorId: string;
  papelId?: string | null;
}

export function buildUserSectorLinks(us: UsuarioSetorRecord, viewer?: Viewer): Links {
  const selfHref = path`/admin/user-sectors/${us.id}`;
  const canMutate = isAdmin(viewer) || isStaff(viewer);

  return buildLinks({
    self: link(selfHref, "GET"),
    update: canMutate && link(selfHref, "PATCH"),
    delete: canMutate && link(selfHref, "DELETE"),
    user: link(path`/users/${us.usuarioId}`, "GET"),
    sector: link(path`/admin/sectors/${us.setorId}`, "GET"),
  });
}