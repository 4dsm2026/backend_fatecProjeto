import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { createTestApp } from '../_setup/createTestApp'
import type { TestContext, TestSession } from '../_setup/contracts'

function request(ctx: TestContext, session: TestSession, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${session.accessToken}`)
  if (init.body) headers.set('content-type', 'application/json')
  return fetch(new URL(path, ctx.baseUrl), { ...init, headers })
}

describe('Integração: usuários, papéis e auditoria', () => {
  it('admin cria, consulta e remove usuário; aluno não pode criar', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const student = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const suffix = randomBytes(6).toString('hex')
    const input = { nome: 'Funcionário teste', emailPessoal: `staff-${suffix}@example.test`, papel: 'TECNICO', senha: `Teste-${suffix}aA1!` }
    const forbidden = await request(ctx, student, '/users', { method: 'POST', body: JSON.stringify(input) })
    expect(forbidden.status).toBe(403)
    const create = await request(ctx, admin, '/users', { method: 'POST', body: JSON.stringify(input) })
    expect(create.status).toBe(201)
    const user = await create.json() as { id: string; emailPessoal: string; _links: Record<string, unknown> }
    expect(create.headers.get('location')).toBe(`/users/${user.id}`)
    expect(user.emailPessoal).toBe(input.emailPessoal)
    expect(user).not.toHaveProperty('senhaHash')
    expect(user._links).toHaveProperty('delete')
    const list = await request(ctx, admin, `/users?q=${encodeURIComponent(input.emailPessoal)}&page=0&size=10`)
    expect(list.status).toBe(200)
    const collection = await list.json() as { _embedded: { users: Array<{ id: string }> }; page: { number: number } }
    expect(collection.page.number).toBe(0)
    expect(collection._embedded.users.map(item => item.id)).toContain(user.id)
    const removed = await request(ctx, admin, `/users/${user.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)
    expect(await removed.text()).toBe('')
    const after = await request(ctx, admin, `/users/${user.id}`)
    // O contrato atual mantém a consulta individual após soft delete, mas sem ações.
    expect(after.status).toBe(200)
    const deleted = await after.json() as { deletadoEm: string | null; _links: Record<string, unknown> }
    expect(deleted.deletadoEm).toBeTruthy()
    expect(deleted._links).not.toHaveProperty('update')
    expect(deleted._links).not.toHaveProperty('delete')
    const filtered = await request(ctx, admin, `/users?q=${encodeURIComponent(input.emailPessoal)}&page=0&size=10`)
    const remaining = await filtered.json() as { _embedded: { users: Array<{ id: string }> } }
    expect(remaining._embedded.users.map(item => item.id)).not.toContain(user.id)
    const selfDelete = await request(ctx, admin, `/users/${admin.actor.id}`, { method: 'DELETE' })
    expect(selfDelete.status).toBe(422)
  })

  it('cria e remove papel com Location e protege acesso do aluno', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const student = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    expect((await request(ctx, student, '/admin/roles')).status).toBe(403)
    const role = await request(ctx, admin, '/admin/roles', { method: 'POST', body: JSON.stringify({ nome: `Papel-${randomBytes(6).toString('hex')}` }) })
    expect(role.status).toBe(201)
    const body = await role.json() as { id: string; _links: Record<string, unknown> }
    expect(role.headers.get('location')).toBe(`/admin/roles/${body.id}`)
    expect(body._links).toHaveProperty('delete')
    expect((await request(ctx, admin, `/admin/roles/${body.id}`, { method: 'DELETE' })).status).toBe(204)
  })

  it('registra na auditoria a criação realizada pela API', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const suffix = randomBytes(6).toString('hex')
    const created = await request(ctx, admin, '/users', { method: 'POST', body: JSON.stringify({ nome: 'Auditoria teste', emailPessoal: `audit-${suffix}@example.test`, papel: 'TECNICO', senha: `Teste-${suffix}aA1!` }) })
    expect(created.status).toBe(201)
    const user = await created.json() as { id: string }
    const logs = await request(ctx, admin, `/admin/audit-logs?userId=${admin.actor.id}&page=0&size=100`)
    expect(logs.status).toBe(200)
    const body = await logs.json() as { _embedded: Record<string, Array<{ acao: string; alvo: string | null }>> }
    const events = body._embedded['audit-logs']
    expect(events.some(event => event.acao === 'USUARIO_CRIADO' && event.alvo?.includes(user.id))).toBe(true)
  })
})
