import { buildLinks, isAdmin, isStaff, link } from "./links";
import type { Links, Viewer } from "./types";

/**
 * Links de entrada da API (o "menu" do `GET /api`), filtrados pelo papel de quem pede.
 * Reaproveitado pelo `GET /users/me`.
 */
export function entryLinks(viewer: Viewer): Links {
  const staff = isStaff(viewer);
  const admin = isAdmin(viewer);

  return buildLinks({
    self: link("/api"),
    "current-user": link("/users/me"),
    session: link("/sessions/current", "DELETE"),
    tickets: link("/tickets"),
    notifications: link("/notifications"),
    suggestions: link("/suggestions"),
    catalog: link("/catalog"),
    users: staff && link("/users"),
    "ticket-stats": staff && link("/ticket-stats"),
    sectors: admin && link("/admin/sectors"),
    roles: admin && link("/admin/roles"),
    "audit-logs": admin && link("/admin/audit-logs"),
    "communication-templates": admin && link("/admin/communication-templates"),
  });
}