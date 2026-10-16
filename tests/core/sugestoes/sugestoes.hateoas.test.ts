import { describe, expect, it } from "vitest";
import {
  buildSuggestionCollectionLinks,
  buildSuggestionLinks,
} from "../../../src/core/sugestoes/sugestoes.hateoas";

const user = { id: "user-1", role: "USUARIO" as const };
const staff = { id: "staff-1", role: "TECNICO" as const };
const userSuggestion = { id: "sug-1", status: "NAO_RESPONDIDO" as const };

describe("suggestion HATEOAS links", () => {
  it("offers only reading links to the owner role", () => {
    expect(buildSuggestionLinks(userSuggestion, user)).toEqual({
      self: { href: "/sugestoes/sug-1", method: "GET" },
      collection: { href: "/sugestoes", method: "GET" },
    });
  });

  it("offers the response action to staff only while the suggestion is open", () => {
    expect(buildSuggestionLinks(userSuggestion, staff)).toMatchObject({
      respond: { href: "/sugestoes/sug-1", method: "PATCH" },
    });
    expect(buildSuggestionLinks({ id: "sug-1", status: "RESPONDIDO" }, staff)).not.toHaveProperty("respond");
  });

  it("offers creation only to an authenticated viewer", () => {
    expect(buildSuggestionCollectionLinks(user)).toEqual({
      create: { href: "/sugestoes", method: "POST" },
    });
    expect(buildSuggestionCollectionLinks()).toEqual({});
  });
});
