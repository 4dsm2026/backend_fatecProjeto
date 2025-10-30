import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from '@fastify/multipart'; 
import fastifyStatic from '@fastify/static'; 
import path from 'path'; 
import fs from 'fs'; 
import prismaPlugin from "./plugins/prisma";
import authRoutes from "./core/auth/auth.routes";
import cookiePlugin from './plugins/cookie';
import authVerify from "./plugins/auth-verify";
import { usersRoutes } from "./core/users/users.routes";
import { ticketsRoutes } from "./core/tickets/tickets.routes";
import { catalogoRoutes } from "./core/catalogo/catalogo.routes";
import swaggerPlugin from "./plugins/swagger";
import { setoresRoutes } from "./core/setores/setores.routes";
import { papeisRoutes } from "./core/papeis/papeis.routes";
import { usuarioSetorRoutes } from "./core/usuario-setor/usuarioSetor.routes";
import { notificationsRoutes } from "./core/notifications/notifications.routes";
import { anexoRoutes } from "./core/anexos/anexos.routes";

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads'); 
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`Pasta de uploads criada em: ${UPLOADS_DIR}`);
} else {
  console.log(`Pasta de uploads já existe em: ${UPLOADS_DIR}`);
}


export async function buildApp() {
  const app = Fastify({ logger: true });

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

  await app.register(prismaPlugin);
  await app.register(cookiePlugin);
  await app.register(authVerify);
  await app.register(swaggerPlugin);
  await app.register(multipart);

  await app.register(fastifyStatic, {
    root: UPLOADS_DIR,
    prefix: '/downloads/', 
    decorateReply: false 
  });

  app.addHook("onRoute", (r) => app.log.info({ method: r.method, url: r.url }, "ROUTE"));
  app.addHook("onRequest", async (req) => req.log.info({ method: req.method, url: req.url }, "REQ"));
  app.addHook("onSend", async (req, reply, payload) => {
    req.log.info({ statusCode: reply.statusCode }, "RES");
    return payload;
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

  app.get("/health", async () => ({ ok: true }));

  return app;
}
