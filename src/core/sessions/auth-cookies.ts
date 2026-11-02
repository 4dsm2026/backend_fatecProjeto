import type { FastifyReply } from "fastify";
import { REFRESH_TOKEN_TTL_MS } from "../../security/refresh";

const DEFAULT_ACCESS_EXPIRES = 15 * 60;

// COOKIE_SECURE=true apenas quando o site roda em HTTPS.
// NODE_ENV=production não garante HTTPS (ex: IP direto na AWS sem TLS).
const cookieSecure = process.env.COOKIE_SECURE === "true";

/** Aceita segundos (900), "15m" ou "1h"; qualquer outra coisa cai no padrão de 15 min. */
function parseExpires(v?: string | number) {
  if (!v) return DEFAULT_ACCESS_EXPIRES;
  if (typeof v === "number") return Number(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([0-9]+)m$/.exec(s);
  if (m) return Number(m[1]) * 60;
  const h = /^([0-9]+)h$/.exec(s);
  if (h) return Number(h[1]) * 3600;
  return DEFAULT_ACCESS_EXPIRES;
}

/** Grava os cookies de sessão (o middleware do front lê o accessToken daqui). */
export function setAuthCookies(res: FastifyReply, accessToken: string, refreshToken: string) {
  const r = res as any;
  if (typeof r.setCookie !== "function") {
    try {
      (res as any).request?.log?.warn?.("setCookie não disponível no FastifyReply — pulando setAuthCookies");
    } catch {}
    return;
  }
  const maxAge = parseExpires(process.env.JWT_ACCESS_EXPIRES);
  r.setCookie("accessToken", accessToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSecure ? "none" : "lax",
    path: "/",
    maxAge,
  });
  r.setCookie("refreshToken", refreshToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSecure ? "none" : "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_MS / 1000,
  });
}
