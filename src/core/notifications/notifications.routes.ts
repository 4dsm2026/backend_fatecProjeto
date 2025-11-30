// core/notifications/notifications.routes.ts
import type { FastifyInstance } from "fastify";
import {
  list,
  readOne,
  archive,
  unarchive,
  readAll,
  createTest,
} from "./notifications.controller";

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  // GET /notifications
  app.get("/", list);

  // POST /notifications/read-all
  app.post("/read-all", readAll);

  // POST /notifications/test
  app.post("/test", createTest);

  // PATCH /notifications/:id/lida
  app.patch("/:id/lida", readOne);

  // POST /notifications/:id/archive
  app.post("/:id/archive", archive);

  // POST /notifications/:id/unarchive
  app.post("/:id/unarchive", unarchive);
}
