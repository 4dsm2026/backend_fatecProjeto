import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { waitForEmail } from '../_helpers/mailbox'
import { createTestApp } from '../_setup/createTestApp'

describe('Integração: login e bloqueio', () => {
  it('troca senha autenticada exige senha atual e encerra a sessão anterior', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    const session = await loginAs(ctx, actor)
    const nextPassword = `Nova-${randomBytes(16).toString('hex')}aA1!`
    const change = (senhaAtual: string) => fetch(new URL('/users/me/password', ctx.baseUrl), {
      method: 'PUT', headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ senhaAtual, novaSenha: nextPassword }),
    })
    expect((await change('senha-errada')).status).toBe(422)
    expect((await change(actor.password)).status).toBe(204)
    await waitForEmail(actor.email, 'Sua senha foi alterada')
    const refresh = await fetch(new URL('/tokens', ctx.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) })
    expect(refresh.status).toBe(401)
    const login = await fetch(new URL('/sessions', ctx.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email, password: nextPassword }) })
    expect(login.status).toBe(201)
  })
  it('aceita RA e devolve cookies e resposta sem cache', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const ra = String(Number.parseInt(randomBytes(6).toString('hex'), 16))
      await prisma.usuario.update({ where: { id: actor.id }, data: { ra } })
      const response = await fetch(new URL('/sessions', ctx.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ra, password: actor.password }) })
      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(response.headers.get('set-cookie')).toContain('accessToken=')
      expect(response.headers.get('set-cookie')).toContain('refreshToken=')
      expect((await response.json()).user.id).toBe(actor.id)
    } finally { await prisma.$disconnect() }
  })

  it('bloqueia após cinco senhas incorretas e impede login de conta inativa', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    const inactive = await createUser(ctx, 'USUARIO')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      await prisma.usuario.update({ where: { id: inactive.id }, data: { ativo: false } })
      const login = (email: string, password: string) => fetch(new URL('/sessions', ctx.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
      for (let i = 0; i < 5; i++) expect((await login(actor.email, 'senha-incorreta')).status).toBe(401)
      const locked = await login(actor.email, actor.password)
      expect(locked.status).toBe(429)
      expect(locked.headers.get('retry-after')).toBeTruthy()
      expect((await login(inactive.email, inactive.password)).status).toBe(403)
    } finally { await prisma.$disconnect() }
  })
})
