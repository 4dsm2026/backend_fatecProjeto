import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";
import authVerify from "./plugins/auth-verify";
import { usersRoutes } from "./core/users/users.routes";
import { ticketsRoutes } from "./core/tickets/tickets.routes";
import { catalogoRoutes } from "./core/catalogo/catalogo.routes";
import swaggerPlugin from "./plugins/swagger"; 

export async function buildApp() {
  const app = Fastify({ logger: true });

  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });

  // ====== Plugins ======
  await app.register(prismaPlugin);
  await app.register(authVerify);
  await app.register(swaggerPlugin); // ✅ Swagger em /docs

  // ====== Logs úteis ======
  app.addHook("onRoute", (r) =>
    app.log.info({ method: r.method, url: r.url }, "ROUTE"),
  );
  app.addHook("onRequest", async (req) => {
    req.log.info({ method: req.method, url: req.url }, "REQ");
  });
  app.addHook("onSend", async (req, reply, payload) => {
    req.log.info({ statusCode: reply.statusCode }, "RES");
    return payload;
  });

  // ====== Rotas principais ======
  app.register(authRoutes, { prefix: "/auth" });
  app.register(usersRoutes, { prefix: "/usuarios" });
  app.register(ticketsRoutes, { prefix: "/tickets" });
  app.register(catalogoRoutes, { prefix: "/catalogo" });


  // ====== Health Check ======
  app.get("/health", async () => ({ ok: true }));

  return app;
}
