import fp from "fastify-plugin";
import { verifyAccessToken } from "../utils/jwt";

export default fp(async (app) => {
  app.decorate("authenticate", async (req: { headers: { authorization: any; }; }, res: { code: (arg0: number) => { (): any; new(): any; send: { (arg0: { error: string; }): any; new(): any; }; }; }) => {
    try {
      const auth = req.headers.authorization;
      if (!auth) throw new Error("Token ausente");

      const token = auth.replace("Bearer ", "");
      const decoded = verifyAccessToken(token);

      (req as any).user = decoded; // agora req.user existe
    } catch (err) {
      app.log.warn({ err }, "❌ Falha de autenticação JWT");
      return res.code(401).send({ error: "Não autorizado" });
    }
  });
});
