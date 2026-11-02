import { describe, expect, it } from "vitest";
import { buildCatalogLinks } from "../../../src/core/catalogo/catalogo.hateoas";

describe("buildCatalogLinks", () => {
  it("offers the public catalog endpoint in the English URL convention", () => {
    expect(buildCatalogLinks()).toEqual({
      self: { href: "/catalog", method: "GET" },
    });
  });
});
