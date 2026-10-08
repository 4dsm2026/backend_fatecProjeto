/**
 * Builders de links HAL do módulo de sessão/conta (auth).
 * Funções puras: não consultam banco nem request. Quem chama decide as
 * condições que dependem de regra de outro módulo (ex.: `canUpdate`).
 *
 * As 3 perguntas (CONVENCOES-API / PLANO 2.4) para cada link:
 * a ação existe? o estado permite? o papel permite?
 * Aqui todo usuário autenticado pode logout/refresh/trocar senha, então esses
 * links não dependem do papel; o que varia por papel entra via `extra`
 * (ex.: `entryLinks(viewer)` do núcleo) e o `update` depende da regra do módulo users.
 */
import { buildLinks, link, path, type Links, type Viewer } from "../../hateoas";

const SESSION_CURRENT = "/sessions/current";
const SESSIONS = "/sessions";
const TOKENS = "/tokens";
const ME = "/users/me";
const ME_PASSWORD = "/users/me/password";
const ENTRY = "/api";

/** Resposta de `POST /sessions` e `GET /sessions/current`. */
export function buildSessionLinks(): Links {
  return buildLinks({
    self: link(SESSION_CURRENT, "GET"),
    logout: link(SESSION_CURRENT, "DELETE"),
    refresh: link(TOKENS, "POST"),
    user: link(ME, "GET"),
    password: link(ME_PASSWORD, "PUT"),
    entry: link(ENTRY, "GET"),
  });
}

/**
 * Resposta de `POST /tokens`. Sem `self`: o token não é um recurso endereçável
 * (exceção D-R4 a registrar no CONVENCOES-API.md).
 */
export function buildTokenLinks(): Links {
  return buildLinks({
    session: link(SESSION_CURRENT, "GET"),
    user: link(ME, "GET"),
    refresh: link(TOKENS, "POST"),
  });
}

/** Resposta `202` de `POST /password-resets`. Sem `self` (D-R4). */
export function buildPasswordResetRequestLinks(): Links {
  return buildLinks({
    login: link(SESSIONS, "POST"),
  });
}

/** Dentro do problem `403 password-change-required`: o servidor diz para onde ir. */
export function buildActivationRequiredLinks(activationToken: string): Links {
  return buildLinks({
    activate: link(path`/account-activations/${activationToken}`, "PUT"),
  });
}

export interface CurrentUserLinkOptions {
  /** Regra do módulo users: este viewer pode editar o próprio cadastro? */
  canUpdate: boolean;
  /** Links por papel vindos do núcleo (`entryLinks(viewer)`), quando existir. */
  extra?: Links;
}

/** Resposta de `GET /users/me`. */
export function buildCurrentUserLinks(viewer: Viewer, options: CurrentUserLinkOptions): Links {
  return {
    ...buildLinks({
      self: link(ME, "GET"),
      update: options.canUpdate && link(path`/users/${viewer.id}`, "PATCH"),
      password: link(ME_PASSWORD, "PUT"),
      logout: link(SESSION_CURRENT, "DELETE"),
      entry: link(ENTRY, "GET"),
    }),
    ...options.extra,
  };
}
