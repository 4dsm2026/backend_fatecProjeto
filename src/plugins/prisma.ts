// src/plugins/prisma.ts
import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PapelEnum } from "../validators/users";
import type { AccessTokenPayload } from "../utils/jwt"; // 👉 importa o tipo do token

type PapelValue = z.infer<typeof PapelEnum>;

export default fp(async (app) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  app.decorate("prisma", prisma);

  app.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (req: any, res: any) => Promise<void>; 
    authorize: (papeis: PapelValue[]) => (req: any, res: any) => Promise<void>;
  }

  interface FastifyRequest {
    prisma: PrismaClient;
    user?: AccessTokenPayload; 
  }
}
