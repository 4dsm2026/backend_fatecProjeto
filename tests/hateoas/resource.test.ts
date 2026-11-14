import { describe, it, expect } from "vitest";
import { buildLinks, link, toResource } from "../../src/hateoas";

describe("toResource", () => {
  it("junta os dados com o _links", () => {
    const r = toResource({ id: "1", titulo: "Sem acesso" }, buildLinks({ self: link("/tickets/1") }));
    expect(r).toEqual({
      id: "1",
      titulo: "Sem acesso",
      _links: { self: { href: "/tickets/1", method: "GET" } },
    });
  });

  it("não altera o objeto original", () => {
    const original = { id: "1" };
    toResource(original, buildLinks({ self: link("/tickets/1") }));
    expect(original).toEqual({ id: "1" });
    expect(original).not.toHaveProperty("_links");
  });

  it("o _links informado substitui um _links que já existia nos dados", () => {
    const comLinksAntigos = { id: "1", _links: { velho: link("/velho") } };
    const r = toResource(comLinksAntigos, buildLinks({ self: link("/novo") }));
    expect(Object.keys(r._links)).toEqual(["self"]);
  });

  it("mantém datas e valores nulos", () => {
    const criadoEm = new Date("2026-10-08T00:00:00Z");
    const r = toResource({ criadoEm, alvo: null }, {});
    expect(r.criadoEm).toBe(criadoEm);
    expect(r.alvo).toBeNull();
  });

  it("aceita _links vazio", () => {
    expect(toResource({ id: "1" }, {})).toEqual({ id: "1", _links: {} });
  });
});