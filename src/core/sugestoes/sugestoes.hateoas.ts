import { buildLinks, isStaff, link, path } from "../../hateoas";
import type { Links, Viewer } from "../../hateoas";

export interface SugestaoLinkRecord {
  id: string;
  status: "NAO_RESPONDIDO" | "RESPONDIDO";
  resposta?: string | null;
}

const SUGGESTIONS = "/suggestions";

export function suggestionSelfHref(id: string): string {
  return path`/suggestions/${id}`;
}

export function buildSuggestionLinks(suggestion: SugestaoLinkRecord, viewer?: Viewer): Links {
  const self = suggestionSelfHref(suggestion.id);

  return buildLinks({
    self: link(self),
    collection: link(SUGGESTIONS),
    answer:
      isStaff(viewer) &&
      suggestion.status !== "RESPONDIDO" &&
      !suggestion.resposta &&
      link(self, "PATCH"),
  });
}

export function buildSuggestionCollectionLinks(viewer?: Viewer): Links {
  return buildLinks({
    create: viewer && link(SUGGESTIONS, "POST"),
  });
}
