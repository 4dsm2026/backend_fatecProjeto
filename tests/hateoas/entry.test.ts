import { describe, it, expect } from "vitest";
import { entryLinks } from "../../src/hateoas";
import type { Role } from "../../src/hateoas";

const viewer = (role: Role) => ({ id: "u1", role });
const rels = (role: Role) => Object.keys(entryLinks(viewer(role))).sort((a, b) => a.localeCompare(b));

const BASE = ["catalog", "current-user", "notifications", "self", "session", "suggestions", "tickets"];
const STAFF = ["ticket-stats", "users"];
const ADMIN = ["audit-logs", "communication-templates", "roles", "sectors"];

const sorted = (...lists: string[][]) => lists.flat().sort((a, b) => a.localeCompare(b));

describe("entryLinks", () => {
  it("USUARIO recebe só os links básicos", () => {
    expect(rels("USUARIO")).toEqual(sorted(BASE));
  });

  it.each<Role>(["BACKOFFICE", "TECNICO"])("%s recebe básicos + equipe (sem admin)", (role) => {
    expect(rels(role)).toEqual(sorted(BASE, STAFF));
  });

  it("ADMINISTRADOR recebe tudo", () => {
    expect(rels("ADMINISTRADOR")).toEqual(sorted(BASE, STAFF, ADMIN));
  });

  it("os links de admin usam o prefixo /admin", () => {
    const l = entryLinks(viewer("ADMINISTRADOR"));
    expect(l.sectors).toEqual({ href: "/admin/sectors", method: "GET" });
    expect(l.roles).toEqual({ href: "/admin/roles", method: "GET" });
  });

  it("session é um DELETE em /sessions/current", () => {
    expect(entryLinks(viewer("USUARIO")).session).toEqual({ href: "/sessions/current", method: "DELETE" });
  });

  it("self aponta para /api", () => {
    expect(entryLinks(viewer("USUARIO")).self).toEqual({ href: "/api", method: "GET" });
  });

  
});