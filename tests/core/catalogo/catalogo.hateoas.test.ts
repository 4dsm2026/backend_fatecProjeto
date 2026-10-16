import { describe, expect, it } from "vitest";
import { buildCatalogLinks } from "../../../src/core/catalogo/catalogo.hateoas";

describe("buildCatalogLinks", () => {
  it("offers the existing public catalog endpoint as its only action", () => {
    expect(buildCatalogLinks()).toEqual({
      self: { href: "/catalogo", method: "GET" },
    });
  });
});
