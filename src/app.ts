import Fastify from "fastify";
import prismaPlugin from "./plugins/prisma";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(prismaPlugin);

  app.get("/health", async () => ({ ok: true }));

  return app;
}
