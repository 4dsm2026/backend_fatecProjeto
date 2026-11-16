import { describe, expect, it } from "vitest";
import { buildAuditLogCollectionLinks, buildAuditLogLinks } from "../../../src/core/auditoria/auditoria.hateoas";

const admin = { id: "admin-1", role: "ADMINISTRADOR" as const };

describe("audit log HATEOAS links", () => {
  it("exposes the self, collection and actor links only to administrators", () => {
    expect(
      buildAuditLogLinks({ id: "log-1", feitoPorId: "user-1" }, admin),
    ).toEqual({
      self: { href: "/admin/audit-logs/log-1", method: "GET" },
      collection: { href: "/admin/audit-logs", method: "GET" },
      actor: { href: "/users/user-1", method: "GET" },
    });

    expect(buildAuditLogLinks({ id: "log-1", feitoPorId: null }, {
      id: "user-1",
      role: "USUARIO",
    })).toEqual({
      self: { href: "/admin/audit-logs/log-1", method: "GET" },
    });
  });

  it("offers the creation action only when the viewer is an administrator", () => {
    expect(buildAuditLogCollectionLinks(admin)).toEqual({
      create: { href: "/admin/audit-logs", method: "POST" },
    });
    expect(buildAuditLogCollectionLinks()).toEqual({});
  });
});
