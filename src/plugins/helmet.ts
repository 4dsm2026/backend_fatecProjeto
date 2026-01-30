// src/plugins/helmet.ts
import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import { FastifyInstance } from "fastify";
import { env } from "../env";

export default fp(async function helmetPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === "production"
      ? undefined // usa defaults seguros
      : false,    // desabilitado em dev para Swagger UI funcionar
    crossOriginEmbedderPolicy: false,
  });
});
