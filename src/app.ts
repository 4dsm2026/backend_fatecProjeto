import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(prismaPlugin); 

  app.addHook("onRoute", (r) => console.log("ROUTE", r.method, r.url));
  app.addHook("onRequest", (req) => console.log("REQ", req.method, req.url));

  app.register(authRoutes, { prefix: "/auth" });
  app.get("/health", async () => ({ ok: true }));

  return app;
}
