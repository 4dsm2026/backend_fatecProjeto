// src/plugins/authorize.ts
import { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { z } from 'zod'
import { PapelEnum } from '../validators/users' //

// Extrai o tipo dos papéis definidos no enum
type PapelValue = z.infer<typeof PapelEnum>

// O plugin que adiciona o decorador
async function authorizePlugin(app: any) {
  // Factory de hooks.
  const authorize = (papeisPermitidos: PapelValue[]) => {
    
    // Retorna o hook preHandler
    return async (req: FastifyRequest, res: FastifyReply) => {
      // 1. Verifica se o req.user existe
      if (!req.user) {
        return res.code(401).send({ error: 'Não autenticado (authorize)' })
      }

      // 2. Verifica o papel
      const { role } = req.user
      if (!role) {
        return res.code(403).send({ error: 'Acesso negado (papel não definido no token)' })
      }

      // 3. Verifica se o papel do usuário está na lista de permitidos
      if (!papeisPermitidos.includes(role as PapelValue)) {
        return res.code(403).send({ error: 'Acesso negado (permissão insuficiente)' })
      }
    }
  }

  // Adiciona o factory 'authorize' na instância do Fastify
  app.decorate('authorize', authorize)
}

export default fp(authorizePlugin)
