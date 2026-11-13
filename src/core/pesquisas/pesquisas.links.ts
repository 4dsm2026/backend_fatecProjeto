import { buildLinks, link, path, toResource } from "../../hateoas";
import type { Links, Resource, Viewer } from "../../hateoas";
import { allowedTransitions, canEditPesquisa, canManagePesquisa, canViewResultados } from "./pesquisas.rules";
import type { StatusPesquisa } from "./pesquisas.rules";

export const SURVEYS = "/surveys";

export interface PesquisaLinkRow {
  id: string;
  status: StatusPesquisa;
  aceitaRespostas: boolean;
  /** Só vem para o aluno. */
  respondida?: boolean;
}

export function pesquisaSelfHref(id: string): string {
  return path`/surveys/${id}`;
}

/** Cada link só existe se o papel e o estado permitem (a tela mostra botão se há link). */
export function buildPesquisaLinks(p: PesquisaLinkRow, viewer: Viewer): Links {
  const self = pesquisaSelfHref(p.id);
  const gestor = canManagePesquisa(viewer);
  const aluno = viewer.role === "USUARIO";

  return buildLinks({
    self: link(self),
    collection: link(SURVEYS),
    update: canEditPesquisa(p.status, viewer) && link(self, "PATCH"),
    delete: canEditPesquisa(p.status, viewer) && link(self, "DELETE"),
    transition: allowedTransitions(p.status, viewer).map((to) => link(path`/surveys/${p.id}/status`, "POST", { name: to })),
    copy: gestor && link(path`/surveys/${p.id}/copies`, "POST"),
    results: canViewResultados(viewer) && p.status !== "RASCUNHO" && link(path`/surveys/${p.id}/results`),
    respond: aluno && p.aceitaRespostas && !p.respondida && link(path`/surveys/${p.id}/responses`, "POST"),
  });
}

export function buildPesquisaCollectionLinks(viewer: Viewer): Links {
  return buildLinks({
    create: canManagePesquisa(viewer) && link(SURVEYS, "POST"),
    courses: canViewResultados(viewer) && link(`${SURVEYS}/courses`),
  });
}

export function toPesquisaResource<T extends PesquisaLinkRow>(p: T, viewer: Viewer): Resource<T> {
  return toResource(p, buildPesquisaLinks(p, viewer));
}
