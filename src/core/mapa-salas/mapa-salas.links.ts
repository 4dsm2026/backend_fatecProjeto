import { buildLinks, isAdmin, isStaff, link, path } from "../../hateoas";
import type { Links, Viewer } from "../../hateoas";

export const ROOM_MAPS = "/room-maps";

/** Links do mapa atual: arquivo para todos; histórico para a equipe; gestão para o admin. */
export function linksDoMapa(viewer: Viewer, temMapa: boolean): Links {
  const admin = isAdmin(viewer);
  return buildLinks({
    self: link(`${ROOM_MAPS}/current`),
    file: temMapa && link(`${ROOM_MAPS}/current/file`),
    versions: isStaff(viewer) && link(`${ROOM_MAPS}/versions`),
    upload: admin && link(`${ROOM_MAPS}/versions`, "POST"),
    source: admin && link(`${ROOM_MAPS}/source`),
  });
}

export function linksDaVersao(id: string): Links {
  return buildLinks({ file: link(path`/room-maps/versions/${id}/file`) });
}

export function linksDaFonte(viewer: Viewer, configurada: boolean): Links {
  return buildLinks({
    self: link(`${ROOM_MAPS}/source`),
    update: isAdmin(viewer) && link(`${ROOM_MAPS}/source`, "PUT"),
    test: isAdmin(viewer) && link(`${ROOM_MAPS}/source/test`, "POST"),
    sync: isAdmin(viewer) && configurada && link(`${ROOM_MAPS}/source/sync`, "POST"),
  });
}
