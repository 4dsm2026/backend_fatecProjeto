// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth-verify";
import authRoutes from "./core/auth/auth.routes";


const app = Fastify({
  logger: true,
});

async function buildServer() {
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : [];

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Safari, mobile, curl etc
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

  // await app.register(prismaPlugin);
  await app.register(authPlugin);

  await app.register(authRoutes, { prefix: "/auth" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

buildServer()
  .then((app) => {
    const PORT = Number(process.env.PORT) || 3000;

    app
      .listen({ port: PORT, host: "0.0.0.0" })
      .then(() => {
        app.log.info(`🚀 Server ouvindo na porta ${PORT}`);
      })
      .catch((err) => {
        app.log.error(err);
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error("Erro ao iniciar servidor:", err);
    process.exit(1);
  });
