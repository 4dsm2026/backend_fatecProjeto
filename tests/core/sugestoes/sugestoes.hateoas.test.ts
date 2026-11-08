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
      self: { href: "/suggestions/sug-1", method: "GET" },
      collection: { href: "/suggestions", method: "GET" },
    });
  });

  it("offers the response action to staff only while the suggestion is open", () => {
    expect(buildSuggestionLinks(userSuggestion, staff)).toMatchObject({
      answer: { href: "/suggestions/sug-1", method: "PATCH" },
    });
    expect(buildSuggestionLinks({ id: "sug-1", status: "RESPONDIDO" }, staff)).not.toHaveProperty("answer");
    expect(buildSuggestionLinks({ ...userSuggestion, resposta: "Resposta" }, staff)).not.toHaveProperty("answer");
  });

  it("offers creation only to an authenticated viewer", () => {
    expect(buildSuggestionCollectionLinks(user)).toEqual({
      create: { href: "/suggestions", method: "POST" },
    });
    expect(buildSuggestionCollectionLinks()).toEqual({});
  });
});
