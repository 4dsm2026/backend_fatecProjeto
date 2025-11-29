// src/plugins/auth.ts
import fp from "fastify-plugin";
import { verifyAccessToken, verifyDownloadToken } from "../utils/jwt";

export default fp(async (app) => {
  app.decorate("authenticate", async (req: any, res: any) => {
    // Não quebra preflight CORS
    if (req.method === "OPTIONS") {
      return;
    }

    try {
      let token: string | undefined;

      const authHeader = req.headers?.authorization;
      if (authHeader && typeof authHeader === "string") {
        token = authHeader.replace(/^Bearer\s+/i, "");
      }

      if (!token && req.cookies?.access_token) {
        token = req.cookies.access_token;
      }

      if (!token && (req.query as any)?.access_token) {
        token = (req.query as any).access_token as string;
      }

      if (!token) {
        throw new Error("Token ausente");
      }

      try {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
      } catch (accessErr) {
        const dl = verifyDownloadToken(token);
        req.user = {
          sub: dl.sub,
          __downloadAnexoId: dl.anexoId,
          __download: true,
        };
      }
    } catch (err) {
      app.log.warn({ err }, "Falha de autenticação JWT");
      return res.code(401).send({ error: "Não autorizado" });
    }
  });

  // Se quiser um authorize separado:
  app.decorate(
    "authorize",
    (papeis: string[]) =>
      async (req: any, res: any) => {
        const role = req.user?.role;
        if (!role || !papeis.includes(role)) {
          return res.code(403).send({ error: "Acesso negado" });
        }
      }
  );
});
