// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";

export async function buildApp() {
  const app = Fastify({ logger: true });

  // 1) CORS antes de tudo, com origins explícitas e headers/métodos claros
  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean); // exemplo no .env: http://localhost:3000,http://localhost:5173

  await app.register(cors, {
    origin: (origin, cb) => {
      // permite chamadas sem Origin (ex.: curl, Postman) e as origins whitelisted
      if (!origin || origins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400, // ajuda em dev
  });

  // 2) Prisma
  await app.register(prismaPlugin);

  // 3) Logs úteis (entrada e saída) para ver se o POST está chegando e respondendo
  app.addHook("onRoute", (r) => app.log.info({ method: r.method, url: r.url }, "ROUTE"));
  app.addHook("onRequest", async (req) => {
    req.log.info({ method: req.method, url: req.url }, "REQ");
  });
  app.addHook("onSend", async (req, reply, payload) => {
    req.log.info({ statusCode: reply.statusCode }, "RES");
    return payload;
  });

  // 4) Rotas (depois do CORS!)
  app.register(authRoutes, { prefix: "/auth" });
  app.get("/health", async () => ({ ok: true }));

  return app;
}
