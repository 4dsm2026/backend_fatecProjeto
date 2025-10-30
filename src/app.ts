import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";
import authVerify from "./plugins/auth-verify";
import { usersRoutes } from "./core/users/users.routes";
import { ticketsRoutes } from "./core/tickets/tickets.routes";
import { catalogoRoutes } from "./core/catalogo/catalogo.routes";
import swaggerPlugin from "./plugins/swagger";
import { setoresRoutes } from "./core/setores/setores.routes";
import { papeisRoutes } from "./core/papeis/papeis.routes";
import { usuarioSetorRoutes } from "./core/usuario-setor/usuarioSetor.routes";
import { notificationsRoutes } from "./core/notifications/notifications.routes";
import { PrismaClient } from "@prisma/client";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart);

  // ---------------------------------------------------------
  // 🔐 CORS
  // ---------------------------------------------------------
  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });

  // ---------------------------------------------------------
  // ⚙️ Plugins principais
  // ---------------------------------------------------------
  await app.register(prismaPlugin);
  await app.register(authVerify);
  await app.register(swaggerPlugin);
  await app.register(websocketPlugin);

  // ---------------------------------------------------------
  // 🧩 Logs globais
  // ---------------------------------------------------------
  app.addHook("onRoute", (r) =>
    app.log.info({ method: r.method, url: r.url }, "ROUTE")
  );
  app.addHook("onRequest", async (req) =>
    req.log.info({ method: req.method, url: req.url }, "REQ")
  );
  app.addHook("onSend", async (req, reply, payload) => {
    req.log.info({ statusCode: reply.statusCode }, "RES");
    return payload;
  });

  // ---------------------------------------------------------
  // 🛠️ Rotas
  // ---------------------------------------------------------
  app.register(authRoutes, { prefix: "/auth" });
  app.register(usersRoutes, { prefix: "/usuarios" });
  app.register(ticketsRoutes, { prefix: "/tickets" });
  app.register(catalogoRoutes, { prefix: "/catalogo" });
  app.register(setoresRoutes, { prefix: "/admin" });
  app.register(papeisRoutes, { prefix: "/admin" });
  app.register(usuarioSetorRoutes, { prefix: "/admin" });
  app.register(notificationsRoutes, { prefix: "/notifications" });

 // ---------------------------------------------------------
// 🔌 WEBSOCKET
// ---------------------------------------------------------
const connections = new Map<string, import("ws").WebSocket>();

app.get("/ws", { websocket: true }, (connection, req) => {
  // 🧠 Compatível com todas as versões do Fastify WebSocket
  const socket: import("ws").WebSocket =
    (connection as any).socket ?? (connection as any);

  // ✅ Agora o userId vem via query param: ?userId=...
  const userId = (req.query as any).userId as string | undefined;

  if (!userId) {
    socket.send(JSON.stringify({ error: "Usuário não autenticado (sem userId)" }));
    socket.close();
    return;
  }

  connections.set(userId, socket);
  app.log.info(`✅ WebSocket conectado: ${userId}`);

  socket.on("message", (msg) => {
    app.log.info(`📩 WS [${userId}] → ${msg}`);
  });

  socket.on("close", () => {
    connections.delete(userId);
    app.log.info(`❌ WebSocket desconectado: ${userId}`);
  });

  socket.on("error", (err) => {
    app.log.error({ err }, `💥 Erro no WebSocket (${userId})`);
  });
});

// ---------------------------------------------------------
// 🌍 Broadcast global (chat/notificações)
// ---------------------------------------------------------
(globalThis as any).broadcastWS = (data: any) => {
  for (const [, socket] of connections) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }
};

// ---------------------------------------------------------
// 📣 Notificações persistentes e em tempo real
// ---------------------------------------------------------
app.decorate(
  "notifyUsers",
  async (userIds: string[], data: any, prisma: PrismaClient) => {
    for (const userId of userIds) {
      const socket = connections.get(userId);

      // Envia em tempo real
      if (socket && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(data));
      }

      // Persiste no banco
      await prisma.notificacao.create({
        data: {
          usuarioId: userId,
          titulo: data.titulo || "Nova notificação",
          mensagem: data.mensagem || "Você tem uma atualização no chamado",
          tipo: data.tipo || "SISTEMA",
          canal: data.canal || "IN_APP",
          meta: data.meta ?? {},
        },
      });
    }
  }
);

// ---------------------------------------------------------
// 🧠 Mantém referência global para uso em outros módulos
// ---------------------------------------------------------
(global as any).fastifyAppInstance = app;

app.log.info("🌐 Fastify App registrada em globalThis.fastifyAppInstance");

  return app;
}
