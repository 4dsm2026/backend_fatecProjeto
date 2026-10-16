import { buildLinks, isAdmin, link, path } from "../../hateoas";
import type { Links, Viewer } from "../../hateoas";
import type { AuditoriaRecord } from "./auditoria.types";

const AUDIT_LOGS = "/admin/audit-logs";

export function buildAuditLogLinks(log: AuditoriaRecord, viewer?: Viewer): Links {
  return buildLinks({
    collection: isAdmin(viewer) && link(AUDIT_LOGS),
    actor: isAdmin(viewer)
      ? log.feitoPorId
        ? link(path`/usuarios/${log.feitoPorId}`)
        : false
      : false,
  });
}

export function buildAuditLogCollectionLinks(viewer?: Viewer): Links {
  return buildLinks({
    create: isAdmin(viewer) && link(AUDIT_LOGS, "POST"),
  });
}
