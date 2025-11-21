// src/plugins/prisma.ts
import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PapelEnum } from "../validators/users";

type PapelValue = z.infer<typeof PapelEnum>;

export default fp(async (app) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Disponível em app.prisma
  app.decorate("prisma", prisma);

  // Cria a propriedade em req.prisma
  app.decorateRequest("prisma", null);

  // Em cada requisição, injeta o prisma no req
  app.addHook("onRequest", (req, _reply, done) => {
    (req as any).prisma = prisma;
    done();
  });

  app.addHook("onClose", async (instance) => {
    await (instance as any).prisma.$disconnect();
  });
});

// 🔹 Declaração de tipos do Fastify
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (req: any, res: any) => Promise<void>;
    authorize: (
      papeis: PapelValue[],
    ) => (req: any, res: any) => Promise<void>;
  }

  interface FastifyRequest {
    prisma: PrismaClient;
    user?: {
      sub: string;
      email: string;
      role: string;
      iat?: number;
      exp?: number;
    };
  }
}
