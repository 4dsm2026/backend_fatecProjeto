// src/plugins/auth-verify.ts
import fp from "fastify-plugin";
import { verifyAccessToken } from "../utils/jwt";

export default fp(async (app) => {
  app.decorate("authenticate", async (req: any, res: any) => {
    if (req.method === "OPTIONS") return;

    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader || typeof authHeader !== "string") {
        throw new Error("Token ausente");
      }

      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) throw new Error("Token ausente");

      req.user = verifyAccessToken(token);
    } catch (err) {
      app.log.warn({ err }, "Falha de autenticação JWT");
      return res.code(401).send({ error: "Não autorizado" });
    }
  });

  app.decorate(
    "authorize",
    (papeis: string[]) =>
      async (req: any, res: any) => {
        const role = req.user?.role;
        if (!role || !papeis.includes(role)) {
          return res.code(403).send({ error: "Acesso negado" });
        }
      },
  );
});
