import type { FastifyInstance } from 'fastify'
import { create, list } from './sugestoes.controller'

export async function sugestoesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate as any)

  // POST /sugestoes
  app.post('/', create)

  // GET /sugestoes (lista as sugestões do próprio usuário autenticado)
  app.get('/', list)
}
