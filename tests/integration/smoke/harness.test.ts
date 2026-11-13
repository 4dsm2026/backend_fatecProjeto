import { describe, expect, inject, it } from 'vitest'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestApp } from '../_setup/createTestApp'

describe('harness provisório', () => {
  it('serve health por HTTP e reutiliza a instância', async () => {
    const [a, b] = await Promise.all([createTestApp(), createTestApp()])
    expect(a).toBe(b)
    expect(a.baseUrl).toBe(process.env.WORKFLOW_INTEGRATION_FIRST_URL)
    const response = await fetch(new URL('/health', a.baseUrl))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', db: 'connected' })
  })
  it('autentica usuário real e acessa a entrada da API', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const { hash } = await import('argon2')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const password = 'Smoke-only-A1!23456789'
      const user = await prisma.usuario.create({ data: {
        nome: 'Smoke', emailPessoal: 'smoke@example.test',
        senhaHash: await hash(password), papel: 'USUARIO',
      } })
      const { baseUrl } = await createTestApp()
      const login = await fetch(new URL('/sessions', baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.emailPessoal, password }),
      })
      expect(login.status).toBe(201)
      const body = await login.json() as { accessToken: string; user: { id: string } }
      expect(body.user.id).toBe(user.id)
      expect(body.accessToken).toBeTruthy()
      const entry = await fetch(new URL('/api', baseUrl), { headers: { authorization: `Bearer ${body.accessToken}` } })
      expect(entry.status).toBe(200)
      expect(await entry.json()).toHaveProperty('_links')
      expect(await prisma.sessao.count({ where: { usuarioId: user.id } })).toBe(1)
    } finally { await prisma.$disconnect() }
  })
  it('grava dados e arquivo para verificar o isolamento', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      await prisma.setor.create({ data: { nome: 'isolamento-anterior' } })
      await writeFile(join((await createTestApp()).storageDir, 'isolamento.txt'), 'teste')
    } finally { await prisma.$disconnect() }
  })
  it('inicia o teste seguinte sem dados nem arquivos do anterior', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      expect(await prisma.setor.count({ where: { nome: 'isolamento-anterior' } })).toBe(0)
      await expect(access(join((await createTestApp()).storageDir, 'isolamento.txt'))).rejects.toThrow()
    } finally { await prisma.$disconnect() }
  })
  it('limpa dados com FKs ativas, autorreferência de sessão, storage e preserva migrations e seed', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const { resetDatabase } = await import('../_setup/resetDatabase')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const ctx = await createTestApp()
      await resetDatabase(ctx)
      const user = await prisma.usuario.create({
        data: { nome: 'Sessão FK', emailPessoal: 'fk-sessao@example.test', senhaHash: 'hash', papel: 'USUARIO' },
      })
      const firstSession = await prisma.sessao.create({
        data: { usuarioId: user.id, refreshHash: 'refresh-1', expiraEm: new Date(Date.now() + 60_000) },
      })
      await prisma.sessao.create({
        data: {
          usuarioId: user.id,
          refreshHash: 'refresh-2',
          expiraEm: new Date(Date.now() + 60_000),
          substituidaPorId: firstSession.id,
        },
      })
      await prisma.setor.create({ data: { nome: 'transitório' } })
      const tempFile = join(ctx.storageDir, 'reset-direct.txt')
      await writeFile(tempFile, 'temp')
      await resetDatabase(ctx)
      expect(await prisma.setor.count()).toBe(0)
      expect(await prisma.sessao.count()).toBe(0)
      expect(await prisma.usuario.count()).toBe(0)
      expect(await prisma.papelCatalogo.count()).toBe(1)
      await expect(access(tempFile)).rejects.toThrow()
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM _prisma_migrations`
      expect(Number(rows[0].n)).toBeGreaterThan(0)
    } finally { await prisma.$disconnect() }
  })
  it('recusa reset quando a identidade do banco não confere', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const { resetDatabase } = await import('../_setup/resetDatabase')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      await prisma.setor.create({ data: { nome: 'não apagar' } })
      await prisma.$executeRaw`UPDATE _integration_owner SET token = ${'token-incorreto'}`
      try {
        await expect(resetDatabase()).rejects.toThrow('Banco não pertence')
        expect(await prisma.setor.count()).toBe(1)
      } finally {
        await prisma.$executeRaw`UPDATE _integration_owner SET token = ${inject('integrationToken')}`
      }
      await resetDatabase()
    } finally { await prisma.$disconnect() }
  })
  it('não usa DATABASE_URL do ambiente como destino do reset', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const { resetDatabase } = await import('../_setup/resetDatabase')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    const previous = process.env.DATABASE_URL
    try {
      await prisma.setor.create({ data: { nome: 'reset-no-container' } })
      process.env.DATABASE_URL = 'mysql://invalid:invalid@127.0.0.1:1/not-the-test-database'
      await resetDatabase()
      expect(await prisma.setor.count({ where: { nome: 'reset-no-container' } })).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
      await prisma.$disconnect()
    }
  })
  it('prepara fixtures compartilhadas de chamados via prepareTicketFixtures sem duplicar app ou container', async () => {
    const { prepareTicketFixtures } = await import('../_setup/prepareTicketFixtures')
    const sharedCtx = await createTestApp()
    const fixtures = await prepareTicketFixtures()

    expect(fixtures.ctx.baseUrl).toBe(sharedCtx.baseUrl)
    expect(fixtures.setorId).toBeTruthy()
    expect(fixtures.funcionario.userId).toBeTruthy()
    expect(typeof fixtures.setEncerradoEm).toBe('function')

    const sessions = [
      fixtures.aluno,
      fixtures.outroAluno,
      fixtures.funcionario,
      fixtures.backoffice,
      fixtures.admin,
    ]
    const distinctTokens = new Set(sessions.map(session => session.accessToken))
    expect(distinctTokens.size).toBe(5)
    for (const session of sessions) {
      expect(session.accessToken).toBeTruthy()
    }

    const membersResponse = await fetch(new URL(`/admin/sectors/${fixtures.setorId}/users`, fixtures.ctx.baseUrl), {
      headers: { authorization: `Bearer ${fixtures.admin.accessToken}` },
    })
    expect(membersResponse.status).toBe(200)
    const membersBody = await membersResponse.json() as {
      _embedded?: { users?: Array<{ usuarioId: string }> }
    }
    const memberIds = (membersBody._embedded?.users ?? []).map(item => item.usuarioId)
    expect(memberIds).toContain(fixtures.funcionario.userId)
  })
})
