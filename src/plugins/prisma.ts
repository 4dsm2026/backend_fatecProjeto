// src/plugins/prisma.ts
import fp from "fastify-plugin";
import { prisma } from "../db/prisma";
import { z } from "zod";
import { PapelEnum } from "../validators/users";
import type { AccessTokenPayload } from "../utils/jwt";

type PapelValue = z.infer<typeof PapelEnum>;

export default fp(async (app) => {
  try {
    await prisma.$connect();
    app.log.info("✅ Prisma conectado");
  } catch (err) {
    app.log.error({ err }, "❌ Erro ao conectar Prisma");
    throw err;
  }

  app.decorate("prisma", prisma);

  app.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
    authenticate: (req: any, res: any) => Promise<void>;
    authorize: (papeis: PapelValue[]) => (req: any, res: any) => Promise<void>;
  }

  interface FastifyRequest {
    prisma: typeof prisma;
    user?: AccessTokenPayload;
  }
}
