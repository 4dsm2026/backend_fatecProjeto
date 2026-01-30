// src/plugins/swagger.ts
import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance } from "fastify";
import { env } from "../env";

export default fp(async function swaggerPlugin(app: FastifyInstance) {
  const servers =
    env.NODE_ENV === "production" && env.APP_WEB_URL
      ? [{ url: env.APP_WEB_URL, description: "production" }]
      : [
          {
            url: `http://localhost:${env.PORT}`,
            description: "dev",
          },
        ];

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Helpdesk API",
        description: "Documentação da API (Usuários & Tickets)",
        version: "1.0.0",
      },
      servers,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Auth" },
        { name: "Usuarios" },
        { name: "Tickets" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
  });
});
