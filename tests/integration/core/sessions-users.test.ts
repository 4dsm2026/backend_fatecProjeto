import { beforeEach, describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { createTestApp } from '../_setup/createTestApp'
import type { Actor, Session, TestContext } from '../_setup/contracts'

async function request(ctx: TestContext, path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  return fetch(new URL(path, ctx.baseUrl), { ...init, headers })
}

describe('Integração: sessões e usuários', () => {
  let ctx: TestContext
  let actor: Actor
  let session: Session
  beforeEach(async () => {
    ctx = await createTestApp()
    actor = await createUser(ctx, 'USUARIO')
    session = await loginAs(ctx, actor)
  })

  it('devolve perfil público e links de entrada conforme o papel', async () => {
    const response = await request(ctx, '/users/me', {}, session.accessToken)
    expect(response.status).toBe(200)
    const user = await response.json() as { id: string; senhaHash?: unknown; _links: Record<string, unknown> }
    expect(user.id).toBe(actor.id)
    expect(user).not.toHaveProperty('senhaHash')
    expect(user._links).toHaveProperty('tickets')
    expect(user._links).not.toHaveProperty('users')
    const entry = await request(ctx, '/api', {}, session.accessToken)
    expect(entry.status).toBe(200)
    expect((await entry.json())._links).toHaveProperty('current-user.href', '/users/me')
  })

  it('rotaciona o refresh token e impede reutilização', async () => {
    const rotate = () => request(ctx, '/tokens', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) })
    const first = await rotate()
    expect(first.status).toBe(201)
    const tokens = await first.json() as { refreshToken: string; accessToken: string }
    expect(tokens.refreshToken).not.toBe(session.refreshToken)
    expect(tokens.accessToken).toBeTruthy()
    const reused = await rotate()
    expect(reused.status).toBe(401)
    expect(reused.headers.get('content-type')).toContain('application/problem+json')
  })

  it('encerra a sessão e impede consultar a sessão encerrada', async () => {
    const logout = await request(ctx, '/sessions/current', { method: 'DELETE' }, session.accessToken)
    expect(logout.status).toBe(204)
    expect(await logout.text()).toBe('')
    const current = await request(ctx, '/sessions/current', {}, session.accessToken)
    expect(current.status).toBe(401)
    const refresh = await request(ctx, '/tokens', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) })
    expect(refresh.status).toBe(401)
  })

  it('nega acesso a outro usuário e campos administrativos no próprio perfil', async () => {
    const other = await createUser(ctx, 'USUARIO')
    expect((await request(ctx, `/users/${other.id}`, {}, session.accessToken)).status).toBe(403)
    const changeRole = await request(ctx, `/users/${actor.id}`, { method: 'PATCH', body: JSON.stringify({ papel: 'ADMINISTRADOR' }) }, session.accessToken)
    expect(changeRole.status).toBe(403)
  })
})
