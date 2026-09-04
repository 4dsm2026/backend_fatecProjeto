// src/middlewares/errorHandler.ts
import { FastifyInstance } from "fastify";
import { env } from "../env";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Erro não tratado");

    // Erros de validação do Fastify/Zod
    if (error.validation) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: error.validation,
      });
    }

    // Rate limit
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: error.message,
      });
    }

    // Erro genérico
    const statusCode = error.statusCode ?? 500;
    const payload: Record<string, unknown> = {
      error: statusCode >= 500 ? "Erro interno do servidor" : error.message,
    };

    if (env.NODE_ENV !== "production" && statusCode >= 500) {
      payload.debug = error.message;
      payload.stack = error.stack;
    }

    return reply.status(statusCode).send(payload);
  });
}
