import type { Prisma } from "@prisma/client";

/** O que o `notifyUsers` aceita: vira uma linha em `notificacao` e vai pelo WebSocket. */
export type NotifyPayload = {
  titulo?: string;
  mensagem?: string;
  tipo?: Prisma.NotificacaoCreateInput["tipo"];
  canal?: Prisma.NotificacaoCreateInput["canal"];
  meta?: Record<string, unknown>;
};

export type NotifyUsers = (userIds: string[], data: NotifyPayload) => Promise<void>;

// O app.ts faz `app.decorate("notifyUsers", ...)`: aqui o Fastify passa a saber disso.
declare module "fastify" {
  interface FastifyInstance {
    notifyUsers: NotifyUsers;
  }
}

export type AppGlobals = typeof globalThis & {
  broadcastWS?: (data: unknown) => void;
  fastifyAppInstance?: { notifyUsers?: NotifyUsers };
};

/** `globalThis` com o que o app.ts publica: o broadcast do WebSocket e a instância do Fastify. */
export const appGlobals = (): AppGlobals => globalThis as AppGlobals;
