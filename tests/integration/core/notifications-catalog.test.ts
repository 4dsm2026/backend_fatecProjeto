import { PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { createTestApp } from '../_setup/createTestApp'
import type { TestContext, TestSession } from '../_setup/contracts'

function request(ctx: TestContext, session: TestSession, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${session.accessToken}`)
  if (init.body) headers.set('content-type', 'application/json')
  return fetch(new URL(path, ctx.baseUrl), { ...init, headers })
}

describe('Integração: notificações e catálogo', () => {
  it('isola notificações e marca individualmente e em lote', async () => {
    const ctx = await createTestApp()
    const owner = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const other = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const created = await request(ctx, owner, '/notifications/test', { method: 'POST' })
    expect(created.status).toBe(201)
    const notification = await created.json() as { id: string; _links: Record<string, { href: string; method: string }> }
    expect(created.headers.get('location')).toBe(`/notifications/${notification.id}`)
    expect(notification._links['mark-read']).toMatchObject({ href: `/notifications/${notification.id}`, method: 'PATCH' })
    const denied = await request(ctx, other, `/notifications/${notification.id}`, { method: 'PATCH', body: JSON.stringify({ lida: true }) })
    expect(denied.status).toBe(404)
    const marked = await request(ctx, owner, notification._links['mark-read'].href, { method: 'PATCH', body: JSON.stringify({ lida: true }) })
    expect(marked.status).toBe(200)
    expect((await marked.json()).lidaEm).toBeTruthy()
    expect((await request(ctx, owner, '/notifications/test', { method: 'POST' })).status).toBe(201)
    const list = await request(ctx, owner, '/notifications?apenasNaoLidas=true&page=0&size=20')
    expect(list.status).toBe(200)
    const collection = await list.json() as { page: { number: number; totalElements: number }; _links: Record<string, { href: string; method: string }> }
    expect(collection.page).toMatchObject({ number: 0, totalElements: 1 })
    expect(collection._links['mark-all-read']).toMatchObject({ href: '/notifications', method: 'PATCH' })
    const all = await request(ctx, owner, collection._links['mark-all-read'].href, { method: 'PATCH', body: JSON.stringify({ lida: true }) })
    expect(all.status).toBe(200)
    expect((await all.json()).updatedCount).toBe(1)
  })

  it('lista no catálogo apenas serviços ativos, preservando o link HAL', async () => {
    const ctx = await createTestApp()
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const category = await prisma.categoria.create({ data: { nome: 'Categoria de teste' } })
      await prisma.servico.createMany({ data: [
        { nome: 'Serviço ativo', categoriaId: category.id, ativo: true },
        { nome: 'Serviço inativo', categoriaId: category.id, ativo: false },
      ] })
      const response = await fetch(new URL('/catalog', ctx.baseUrl))
      expect(response.status).toBe(200)
      const body = await response.json() as { categorias: Array<{ id: string; servicos: Array<{ nome: string }> }>; _links: { self: { href: string } } }
      expect(body._links.self.href).toBe('/catalog')
      const services = body.categorias.find((item) => item.id === category.id)?.servicos.map((item) => item.nome)
      expect(services).toContain('Serviço ativo')
      expect(services).not.toContain('Serviço inativo')
    } finally {
      await prisma.$disconnect()
    }
  })
})
