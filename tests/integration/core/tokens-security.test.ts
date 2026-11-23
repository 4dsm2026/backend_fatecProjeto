import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { waitForEmail } from '../_helpers/mailbox'
import { createTestApp } from '../_setup/createTestApp'

const token = () => randomBytes(32).toString('hex')
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex')
const password = `NovaSenha-${randomBytes(16).toString('hex')}aA1!`

describe('Integração: segurança dos tokens', () => {
  it('nega token expirado e token de finalidade incorreta', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const expired = token()
      const activation = token()
      await prisma.tokenResetSenha.createMany({ data: [
        { usuarioId: actor.id, tokenHash: digest(expired), finalidade: 'RESET_SENHA', expiraEm: new Date(Date.now() - 60_000) },
        { usuarioId: actor.id, tokenHash: digest(activation), finalidade: 'PRIMEIRO_ACESSO', expiraEm: new Date(Date.now() + 60_000) },
      ] })
      for (const raw of [expired, activation]) {
        const response = await fetch(new URL(`/password-resets/${raw}`, ctx.baseUrl), {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
        })
        expect(response.status).toBe(404)
      }
    } finally { await prisma.$disconnect() }
  })

  it('reset encerra sessões e invalida os demais tokens de reset pendentes', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    const session = await loginAs(ctx, actor)
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const first = token()
      const second = token()
      await prisma.tokenResetSenha.createMany({ data: [first, second].map(raw => ({
        usuarioId: actor.id, tokenHash: digest(raw), finalidade: 'RESET_SENHA' as const, expiraEm: new Date(Date.now() + 60_000),
      })) })
      const reset = (raw: string) => fetch(new URL(`/password-resets/${raw}`, ctx.baseUrl), {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
      })
      expect((await reset(first)).status).toBe(204)
      await waitForEmail(actor.email, 'Sua senha foi alterada')
      expect((await reset(second)).status).toBe(409)
      const refresh = await fetch(new URL('/tokens', ctx.baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
      expect(refresh.status).toBe(401)
    } finally { await prisma.$disconnect() }
  })
})
