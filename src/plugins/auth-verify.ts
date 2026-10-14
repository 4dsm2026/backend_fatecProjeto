// src/plugins/auth-verify.ts
import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../hateoas";
import { verifyAccessToken } from "../utils/jwt";

// Observação: `FastifyInstance.authenticate`/`authorize` e `FastifyRequest.user`
// já são declarados globalmente em src/plugins/prisma.ts (bloco
// `declare module "fastify"`, ao final do arquivo). Não repetir a
// declaração aqui — o TypeScript funde (merge) interfaces com o mesmo nome
// em arquivos diferentes, e uma segunda declaração com uma assinatura
// textualmente diferente (ex.: `papeis: string[]` vs o `papeis: PapelValue[]`
// já usado lá) gera erro de conflito de tipos (TS2717).

/** RFC 6750: sem credencial, `Bearer` puro; com credencial recusada, `error="invalid_token"`. */
const INVALID_TOKEN = { "WWW-Authenticate": 'Bearer error="invalid_token"' };

export default fp(async (app) => {
  app.decorate("authenticate", async (req: FastifyRequest) => {
    if (req.method === "OPTIONS") return;

    const authHeader = req.headers.authorization;
    const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
    if (!token) {
      throw new ApiError("unauthorized", "Não autenticado", "Envie o token no header Authorization: Bearer <token>");
    }

    try {
      req.user = verifyAccessToken(token);
    } catch (err) {
      app.log.warn({ err }, "Falha de autenticação JWT");
      throw new ApiError("unauthorized", "Token inválido ou expirado", undefined, undefined, {
        headers: INVALID_TOKEN,
      });
    }
  });

  app.decorate(
    "authorize",
    (papeis: string[]) =>
      async (req: FastifyRequest) => {
        const role = req.user?.role;
        if (!role || !papeis.includes(role)) {
          throw new ApiError("forbidden", "Acesso negado", "Seu papel não permite esta ação");
        }
      },
  );
});
