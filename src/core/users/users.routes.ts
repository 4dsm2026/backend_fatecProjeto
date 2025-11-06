import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft } from "./users.controller";

export async function usersRoutes(app: FastifyInstance) {
  
  app.post(
    '/',
    { preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])] },
    create,
  )
  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO']),
      ],
    },
    list,
  )
  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO']),
      ],
    },
    getOne,
  )
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO','USUARIO'])] },
    patch,
  )
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])] },
    removeSoft,
  )
}
