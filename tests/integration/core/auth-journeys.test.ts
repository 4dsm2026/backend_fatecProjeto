import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { extractToken, waitForEmail } from '../_helpers/mailbox'
import { createTestApp } from '../_setup/createTestApp'

describe('Jornadas de acesso', () => {
  it('J2: admin cria aluno, e-mail fornece link de ativação e aluno acessa com nova senha', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const email = `aluno-${randomBytes(6).toString('hex')}@example.test`
    const ra = String(Number.parseInt(randomBytes(6).toString('hex'), 16))
    const created = await fetch(new URL('/users', ctx.baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Aluno J2', emailPessoal: email, ra, papel: 'USUARIO' }),
    })
    expect(created.status).toBe(201)
    const user = await created.json() as { id: string }
    expect(created.headers.get('location')).toBe(`/users/${user.id}`)

    const message = await waitForEmail(email, 'Ative seu acesso')
    const activationPath = `/account-activations/${extractToken(message.html)}`
    const password = `Nova-${randomBytes(16).toString('hex')}aA1!`
    const activate = await fetch(new URL(activationPath, ctx.baseUrl), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
    })
    expect(activate.status).toBe(204)
    const reuse = await fetch(new URL(activationPath, ctx.baseUrl), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
    })
    expect(reuse.status).toBe(404)
    const login = await fetch(new URL('/sessions', ctx.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    })
    expect(login.status).toBe(201)
    expect((await login.json()).user.id).toBe(user.id)
  })

  it('J3: captura e-mail de reset, altera senha e recebe aviso', async () => {
    const ctx = await createTestApp()
    const actor = await createUser(ctx, 'USUARIO')
    await loginAs(ctx, actor)
    const requested = await fetch(new URL('/password-resets', ctx.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email }),
    })
    expect(requested.status).toBe(202)
    const email = await waitForEmail(actor.email, 'Redefinição de senha')
    const token = extractToken(email.html)
    const password = `Nova-${randomBytes(16).toString('hex')}aA1!`
    const reset = await fetch(new URL(`/password-resets/${token}`, ctx.baseUrl), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
    })
    expect(reset.status).toBe(204)
    await waitForEmail(actor.email, 'Sua senha foi alterada')
    const old = await fetch(new URL('/sessions', ctx.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email, password: actor.password }),
    })
    expect(old.status).toBe(401)
    const updated = await fetch(new URL('/sessions', ctx.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email, password }),
    })
    expect(updated.status).toBe(201)
    const reused = await fetch(new URL(`/password-resets/${token}`, ctx.baseUrl), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novaSenha: password }),
    })
    expect(reused.status).toBe(409)
  })
})
