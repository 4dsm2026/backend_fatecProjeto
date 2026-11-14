import { buildLinks, isStaff, link, path, toResource } from "../../hateoas";
import type { Links, Resource, Viewer } from "../../hateoas";
import { allowedTransitions, canRespond } from "./matricula.rules";
import type { StatusSolicitacao } from "./matricula.rules";

export const ENROLLMENT_REQUESTS = "/enrollment-requests";

export interface SolicitacaoLinkRow {
  id: string;
  status: StatusSolicitacao | string;
  usuarioId: string;
}

export function solicitacaoSelfHref(id: string): string {
  return path`/enrollment-requests/${id}`;
}

export function buildSolicitacaoLinks(s: SolicitacaoLinkRow, viewer: Viewer): Links {
  const self = solicitacaoSelfHref(s.id);
  const ctx = { status: s.status as StatusSolicitacao, ownerId: s.usuarioId };
  return buildLinks({
    self: link(self),
    collection: link(ENROLLMENT_REQUESTS),
    student: isStaff(viewer) && link(path`/users/${s.usuarioId}`),
    respond: canRespond(ctx, viewer) && link(path`/enrollment-requests/${s.id}/replies`, "POST"),
    transition: allowedTransitions(ctx, viewer).map((to) => link(path`/enrollment-requests/${s.id}/status`, "POST", { name: to })),
  });
}

export function buildSolicitacaoCollectionLinks(viewer: Viewer): Links {
  const staff = isStaff(viewer);
  return buildLinks({
    create: !staff && link(ENROLLMENT_REQUESTS, "POST"),
    eligibility: !staff && link(`${ENROLLMENT_REQUESTS}/eligibility`),
    summary: staff && link(`${ENROLLMENT_REQUESTS}/summary`),
  });
}

export function toSolicitacaoResource<T extends SolicitacaoLinkRow>(s: T, viewer: Viewer): Resource<T> {
  return toResource(s, buildSolicitacaoLinks(s, viewer));
}
