// src/app.ts
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyFormbody from "@fastify/formbody";
import fastifyCookie from "@fastify/cookie";
import { env } from "./env";
import prismaPlugin from "./plugins/prisma";
import sessionsRoutes from "./core/sessions/sessions.routes";
import authVerify from "./plugins/auth-verify";
import auditoriaRoutes from "./core/auditoria/auditoria.routes";
import { usersRoutes } from "./core/users/users.routes";
import { ticketsRoutes, ticketStatsRoutes } from "./core/tickets/tickets.routes";
import { catalogoRoutes } from "./core/catalogo/catalogo.routes";
import swaggerPlugin from "./plugins/swagger";
import helmetPlugin from "./plugins/helmet";
import rateLimitPlugin from "./plugins/rateLimit";
import { setoresRoutes } from "./core/setores/setores.routes";
import { papeisRoutes } from "./core/papeis/papeis.routes";
import { usuarioSetorRoutes } from "./core/usuario-setor/usuarioSetor.routes";
import { comunicacoesRoutes } from "./core/comunicacoes/comunicacoes.routes";
import { notificationsRoutes } from "./core/notifications/notifications.routes";
import { anexoRoutes } from "./core/anexos/anexos.routes";
import { sugestoesRoutes } from "./core/sugestoes/sugestoes.routes";
import { passeEscolarRoutes } from "./core/passe-escolar/passe-escolar.routes";
import { pesquisasRoutes } from "./core/pesquisas/pesquisas.routes";
import { matriculaRoutes } from "./core/matricula/matricula.routes";
import { verifyAccessToken } from "./utils/jwt";
import { scheduleCleanupAnexos } from "./jobs/cleanupAnexos";
import { entryLinks, registerProblemHandler, toResource } from "./hateoas";
import type { Role } from "./hateoas";
import { redactUrl } from "./utils/redact-url";
import type { RawData, WebSocket } from "ws";
import type { Prisma } from "@prisma/client";
import { appGlobals } from "./types/app-globals";
import type { NotifyPayload } from "./types/app-globals";


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
      // Mesmo conteúdo do serializador padrão do Fastify, mas sem o token que viaja na URL.
      serializers: {
        req: (req: FastifyRequest) => {
          const version = req.headers?.["accept-version"];
          return {
            method: req.method,
            url: redactUrl(req.url),
            version: Array.isArray(version) ? version[0] : version,
            host: req.host,
            remoteAddress: req.ip,
            remotePort: req.socket?.remotePort,
          };
        },
      },
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
    exposedHeaders: ["Location", "Retry-After", "WWW-Authenticate"],
    credentials: true,
  });

  await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
    },
  });

  await app.register(prismaPlugin);
  await app.register(authVerify);
  await app.register(swaggerPlugin);
  await app.register(websocket);

  registerProblemHandler(app);

  // NOTA: /downloads/ foi removido intencionalmente.
  // Arquivos são servidos exclusivamente via GET /attachments/:id/content.

  app.addHook("onRequest", async (req) =>
    req.log.debug({ method: req.method, url: redactUrl(req.url) }, "REQ"),
  );

  // ✅ Health check público
  app.get("/health", {
    schema: {
      tags: ["Sistema"],
      summary: "Verificar saúde da API",
      description:
        "Verifica a conectividade com o banco de dados. Endpoint público. " +
        "Retorna HTTP 200 com `{ status: \"ok\", db: \"connected\" }` quando " +
        "a conexão está disponível, ou HTTP 503 com `{ status: \"degraded\", " +
        "db: \"disconnected\" }` quando o banco não responde.",
      security: [],
    },
  }, async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "connected" };
    } catch {
      return reply.status(503).send({ status: "degraded", db: "disconnected" });
    }
  });

  // Raiz da API (HATEOAS): links de entrada de acordo com o papel de quem pede
  app.get("/api", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string; role: Role };
    return toResource({}, entryLinks({ id: user.sub, role: user.role }));
  });

  app.register(sessionsRoutes);
  app.register(usersRoutes, { prefix: "/users" });
  app.register(ticketsRoutes, { prefix: "/tickets" });
  app.register(ticketStatsRoutes, { prefix: "/ticket-stats" });
  app.register(catalogoRoutes, { prefix: "/catalog" });
  app.register(setoresRoutes, { prefix: "/admin" });
  app.register(papeisRoutes, { prefix: "/admin" });
  app.register(usuarioSetorRoutes, { prefix: "/admin" });
  app.register(comunicacoesRoutes, { prefix: "/admin" });
  app.register(notificationsRoutes, { prefix: "/notifications" });
  app.register(anexoRoutes, { prefix: "/" });
  app.register(sugestoesRoutes, { prefix: "/suggestions" });
  app.register(passeEscolarRoutes, { prefix: "/school-passes" }); // beta
  app.register(pesquisasRoutes, { prefix: "/surveys" }); // beta
  app.register(matriculaRoutes, { prefix: "/enrollment-requests" }); // beta
  app.register(auditoriaRoutes);

  // ---------------------------------------------------------
  // 🔌 WebSocket — autenticado por handshake no primeiro frame.
  // O cliente envia { type: "auth", token } logo após conectar, evitando
  // o JWT na query string (que vaza em logs de acesso/proxy).
  // O token via ?token= ainda é aceito como fallback de compatibilidade.
  // ---------------------------------------------------------
  const connections = new Map<string, WebSocket>();
  const AUTH_TIMEOUT_MS = 10_000;

  /** Frame que o cliente manda pelo WebSocket. Os campos chegam sem garantia de tipo. */
  type WsFrame = {
    type?: unknown;
    token?: unknown;
  };

  /** `null` se não for JSON; um frame vazio se for JSON que não seja um objeto. */
  function parseWsFrame(raw: RawData): WsFrame | null {
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      return typeof parsed === "object" && parsed !== null ? (parsed as WsFrame) : {};
    } catch {
      return null;
    }
  }

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    let userId: string | null = null;
    let authTimer: ReturnType<typeof setTimeout> | null = null;

    function authenticate(token: unknown): boolean {
      if (typeof token !== "string" || !token) return false;
      try {
        userId = verifyAccessToken(token).sub;
        connections.set(userId, socket);
        app.log.info(`WS conectado: userId=${userId}`);
        return true;
      } catch {
        return false;
      }
    }

    function stopAuthTimer(): void {
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
    }

    // Handshake: enquanto não autenticado, só o frame { type: "auth" } vale.
    function handshake(frame: WsFrame): void {
      if (frame.type === "auth" && authenticate(frame.token)) {
        stopAuthTimer();
        socket.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      socket.send(JSON.stringify({ error: "Não autenticado" }));
      socket.close();
    }

    // Autenticação exclusivamente pelo 1º frame { type: "auth", token } — o
    // token nunca vai na URL (evita vazamento em logs). Fecha se não chegar.
    authTimer = setTimeout(() => {
      if (!userId) {
        socket.send(JSON.stringify({ error: "Timeout de autenticação" }));
        socket.close();
      }
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (rawMsg: RawData) => {
      const frame = parseWsFrame(rawMsg);
      if (!frame) return;

      // Depois do handshake o cliente não envia nada que o servidor aceite:
      // `nova_mensagem` nasce só no POST /tickets/:id/messages e é emitida pelo
      // servidor (broadcastWS). Repassar frames de clientes permitia forjar
      // mensagens de outra pessoa.
      if (!userId) handshake(frame);
    });

    socket.on("close", () => {
      stopAuthTimer();
      if (userId) {
        connections.delete(userId);
        app.log.info(`WS desconectado: userId=${userId}`);
      }
    });

    socket.on("error", (err: unknown) => {
      app.log.error({ err }, `WS erro (${userId ?? "não autenticado"})`);
    });
  });

  appGlobals().broadcastWS = (data: unknown) => {
    for (const [, socket] of connections) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    }
  };

  async function getInAppOptInUserIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();

    const optIn = await app.prisma.usuario.findMany({
      where: { id: { in: userIds }, notificacoesInApp: true },
      select: { id: true },
    });

    return new Set(optIn.map((u: { id: string }) => u.id));
  }

  app.decorate("notifyUsers", async (userIds: string[], data: NotifyPayload) => {
    const alvos = await getInAppOptInUserIds(userIds);

    for (const userId of userIds) {
      if (!alvos.has(userId)) continue;

      const socket = connections.get(userId);
      if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));

      await app.prisma.notificacao.create({
        data: {
          usuarioId: userId,
          titulo: data.titulo ?? "Nova notificação",
          mensagem: data.mensagem ?? "Você tem uma atualização no chamado",
          tipo: data.tipo ?? "SISTEMA",
          canal: data.canal ?? "IN_APP",
          meta: (data.meta ?? {}) as Prisma.InputJsonObject,
        },
      });
    }
  });

  // Referência global usada por messages.service. É uma limitação conhecida da arquitetura:
  // o ideal seria injetar a instância por um plugin do Fastify, sem passar por `globalThis`.
  appGlobals().fastifyAppInstance = app;

  scheduleCleanupAnexos(app.prisma, UPLOADS_DIR);

  return app;
}
