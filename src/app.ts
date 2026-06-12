// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyFormbody from "@fastify/formbody";
import fastifyCookie from "@fastify/cookie";
import path from "path";
import fs from "fs";

import { env } from "./env";
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";
import authVerify from "./plugins/auth-verify";
import authorizePlugin from "./plugins/authorize";
import auditoriaRoutes from "./core/auditoria/auditoria.routes";
import { usersRoutes } from "./core/users/users.routes";
import { ticketsRoutes } from "./core/tickets/tickets.routes";
import { catalogoRoutes } from "./core/catalogo/catalogo.routes";
import swaggerPlugin from "./plugins/swagger";
import helmetPlugin from "./plugins/helmet";
import rateLimitPlugin from "./plugins/rateLimit";
import { registerErrorHandler } from "./middlewares/errorHandler";
import { setoresRoutes } from "./core/setores/setores.routes";
import { papeisRoutes } from "./core/papeis/papeis.routes";
import { usuarioSetorRoutes } from "./core/usuario-setor/usuarioSetor.routes";
import { notificationsRoutes } from "./core/notifications/notifications.routes";
import { anexoRoutes } from "./core/anexos/anexos.routes";
import { verifyAccessToken } from "./utils/jwt";
import { scheduleCleanupAnexos } from "./jobs/cleanupAnexos";

/* ====== Configuração de uploads ====== */
const UPLOADS_DIR = path.resolve(
  env.STORAGE_DRIVER === "local" ? env.LOCAL_STORAGE_DIR : "./uploads",
);
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      ...(env.NODE_ENV !== "production" && {
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    },
    trustProxy: true,
  });

  await app.register(helmetPlugin);
  await app.register(rateLimitPlugin);
  await app.register(fastifyFormbody);

  // Limite de 10MB por arquivo (proteção contra DoS por upload)
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const allowedOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : [];

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      app.log.warn({ origin }, "Origin bloqueado pelo CORS");
      return cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET || "dev-secret",
    parseOptions: {
      httpOnly: true,
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
    },
  });

  await app.register(prismaPlugin);
  await app.register(authVerify);
  await app.register(authorizePlugin);
  await app.register(swaggerPlugin);
  await app.register(websocket);

  registerErrorHandler(app);

  // NOTA: /downloads/ foi removido intencionalmente.
  // Arquivos são servidos exclusivamente via GET /anexos/:id (rota autenticada).

  app.addHook("onRequest", async (req) =>
    req.log.debug({ method: req.method, url: req.url }, "REQ"),
  );

  // ✅ Health check público
  app.get("/health", async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "connected" };
    } catch {
      return reply.status(503).send({ status: "degraded", db: "disconnected" });
    }
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(usersRoutes, { prefix: "/usuarios" });
  app.register(ticketsRoutes, { prefix: "/tickets" });
  app.register(catalogoRoutes, { prefix: "/catalogo" });
  app.register(setoresRoutes, { prefix: "/admin" });
  app.register(papeisRoutes, { prefix: "/admin" });
  app.register(usuarioSetorRoutes, { prefix: "/admin" });
  app.register(notificationsRoutes, { prefix: "/notifications" });
  app.register(anexoRoutes, { prefix: "/" });
  app.register(auditoriaRoutes);

  // ---------------------------------------------------------
  // 🔌 WebSocket — autenticado via Bearer no header
  // AVISO: passar JWT via ?token= na query expõe o token em logs.
  // Prefira passar via primeiro frame após conexão (protocolo de handshake).
  // ---------------------------------------------------------
  const connections = new Map<string, import("ws").WebSocket>();

  app.get("/ws", { websocket: true }, (connection, req) => {
    const socket = (connection as any).socket ?? (connection as any);
    const token = (req.query as any)?.token;

    let userId: string;
    try {
      if (!token) throw new Error("Token ausente");
      const payload = verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      socket.send(JSON.stringify({ error: "Não autenticado" }));
      socket.close();
      return;
    }

    app.log.info(`WS conectado: userId=${userId}`);
    connections.set(userId, socket);

    socket.on("message", async (rawMsg: string) => {
      try {
        const data = JSON.parse(rawMsg);
        if (data.type === "nova_mensagem") {
          const { chamadoId, mensagem, autorId, autor } = data;
          for (const [, client] of connections) {
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({
                type: "nova_mensagem",
                chamadoId,
                mensagem: {
                  id: Date.now().toString(),
                  conteudo: mensagem,
                  criadoEm: new Date().toISOString(),
                  autorId,
                  autor,
                },
              }));
            }
          }
        }
      } catch (err) {
        app.log.error({ err }, "Erro ao processar WS message");
      }
    });

    socket.on("close", () => {
      connections.delete(userId);
      app.log.info(`WS desconectado: userId=${userId}`);
    });

    socket.on("error", (err: unknown) => {
      app.log.error({ err }, `WS erro (${userId})`);
    });
  });

  (globalThis as any).broadcastWS = (data: any) => {
    for (const [, socket] of connections) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    }
  };

  app.decorate("notifyUsers", async (userIds: string[], data: any) => {
    for (const userId of userIds) {
      const socket = connections.get(userId);
      if (socket?.readyState === socket?.OPEN) socket.send(JSON.stringify(data));

      await app.prisma.notificacao.create({
        data: {
          usuarioId: userId,
          titulo: data.titulo ?? "Nova notificação",
          mensagem: data.mensagem ?? "Você tem uma atualização no chamado",
          tipo: data.tipo ?? "SISTEMA",
          canal: data.canal ?? "IN_APP",
          meta: data.meta ?? {},
        },
      });
    }
  });

  // Referência global usada por messages.service — necessária por limitação de arquitetura
  // TODO: refatorar para injeção de dependência via plugin Fastify
  (global as any).fastifyAppInstance = app;

  scheduleCleanupAnexos(app.prisma, UPLOADS_DIR);

  return app;
}
