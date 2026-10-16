import { buildLinks, isStaff, link, path } from "../../hateoas";
import type { Links, Viewer } from "../../hateoas";

export interface SugestaoLinkRecord {
  id: string;
  status: "NAO_RESPONDIDO" | "RESPONDIDO";
}

const SUGGESTIONS = "/sugestoes";

export function suggestionSelfHref(id: string): string {
  return path`/sugestoes/${id}`;
}

export function buildSuggestionLinks(suggestion: SugestaoLinkRecord, viewer?: Viewer): Links {
  const self = suggestionSelfHref(suggestion.id);

  return buildLinks({
    self: link(self),
    collection: link(SUGGESTIONS),
    respond:
      isStaff(viewer) &&
      suggestion.status !== "RESPONDIDO" &&
      link(self, "PATCH"),
  });
}

export function buildSuggestionCollectionLinks(viewer?: Viewer): Links {
  return buildLinks({
    create: viewer && link(SUGGESTIONS, "POST"),
  });
}
