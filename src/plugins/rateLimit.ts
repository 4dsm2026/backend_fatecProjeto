// src/plugins/rateLimit.ts
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";

export default fp(async function rateLimitPlugin(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1", "::1"],
    keyGenerator: (req) =>
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Limite de requisições atingido. Tente novamente em ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });
});

/** Limite estrito para rotas de autenticação (login, reset, primeiro-acesso). */
export const authRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute",
    },
  },
};
