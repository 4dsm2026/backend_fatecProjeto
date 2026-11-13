import { buildLinks, isStaff, link, path, toResource } from "../../hateoas";
import type { Links, Resource, Viewer } from "../../hateoas";
import { allowedTransitions, canUpdatePasse } from "./passe-escolar.rules";
import type { StatusPasseEscolar } from "./passe-escolar.rules";

export const SCHOOL_PASSES = "/school-passes";

/** O que os links precisam saber do pedido. */
export interface PasseRow {
  id: string;
  status: StatusPasseEscolar | string;
  usuarioId: string;
}

export function passeSelfHref(id: string): string {
  return path`/school-passes/${id}`;
}

/** Cada link só existe se o estado e o papel permitem (a tela mostra botão se há link). */
export function buildPasseLinks(passe: PasseRow, viewer: Viewer): Links {
  const self = passeSelfHref(passe.id);
  const ctx = { status: passe.status as StatusPasseEscolar, ownerId: passe.usuarioId };

  return buildLinks({
    self: link(self),
    collection: link(SCHOOL_PASSES),
    update: canUpdatePasse(ctx, viewer) && link(self, "PATCH"),
    transition: allowedTransitions(ctx, viewer).map((to) => link(path`/school-passes/${passe.id}/status`, "POST", { name: to })),
  });
}

export function buildPasseCollectionLinks(viewer: Viewer): Links {
  return buildLinks({
    create: !isStaff(viewer) && link(SCHOOL_PASSES, "POST"),
    export: isStaff(viewer) && link(`${SCHOOL_PASSES}/export`),
  });
}

export function toPasseResource<T extends PasseRow>(passe: T, viewer: Viewer): Resource<T> {
  return toResource(passe, buildPasseLinks(passe, viewer));
}
