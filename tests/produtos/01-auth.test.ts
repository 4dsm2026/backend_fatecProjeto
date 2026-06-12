/**
 * Produto: Autenticação
 * Cobre: login por e-mail/RA, primeiro acesso, /me, register, logout, health
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// Must be hoisted before any src/ import that touches Prisma
vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
// Replace argon2 (slow) with instant stubs
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeLoginUser, makeUser, IDS } from '../helpers/factories'
import { makeAdminToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'
import * as passwordModule from '../../src/security/password'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
  // Restore password mocks after resetAllMocks clears them
  vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true)
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:password')
  // Common auth side effects
  prismaMock.loginTentativa.create.mockResolvedValue({})
  prismaMock.sessao.create.mockResolvedValue({ id: 'session-001' })
  prismaMock.tokenResetSenha.create.mockResolvedValue({ id: 'token-001' })
  prismaMock.usuario.update.mockResolvedValue(makeLoginUser())
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('retorna status ok quando banco responde', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', db: 'connected' })
  })

  it('retorna 503 quando banco está fora', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'degraded' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  it('200 — login bem-sucedido por e-mail', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser())

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('accessToken')
    expect(body).toHaveProperty('refreshToken')
    expect(body.user).toMatchObject({ id: IDS.user, nome: 'João Silva' })
  })

  it('200 — login bem-sucedido por RA', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ ra: '1234567' }))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ra: '1234567', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('accessToken')
  })

  it('401 — usuário não encontrado', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'fantasma@example.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toHaveProperty('error')
  })

  it('401 — senha incorreta', async () => {
    const { verifyPassword } = await import('../../src/security/password')
    vi.mocked(verifyPassword).mockResolvedValueOnce(false)
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser())
    prismaMock.usuario.update.mockResolvedValueOnce({ ...makeLoginUser(), loginAttempts: 1 })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com', password: 'SenhaErrada123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('403 — usuário inativo', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ ativo: false }))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toHaveProperty('error', 'Usuário inativo')
  })

  it('428 — usuário precisa trocar senha (primeiro acesso)', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(
      makeLoginUser({ precisaTrocarSenha: true }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(428)
    const body = res.json()
    expect(body).toHaveProperty('code', 'PASSWORD_CHANGE_REQUIRED')
    expect(body).toHaveProperty('token') // reset token for first-access flow
  })

  it('423 — conta bloqueada por muitas tentativas', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(
      makeLoginUser({ lockedUntil: new Date(Date.now() + 15 * 60_000) }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(423)
    expect(res.json()).toHaveProperty('error', 'Conta bloqueada')
  })

  it('400 — body inválido (sem password)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@example.com' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('400 — body inválido (sem identificador)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  it('401 — sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(401)
  })

  it('200 — retorna dados do usuário autenticado', async () => {
    const user = makeUser()
    prismaMock.usuario.findUnique.mockResolvedValueOnce(user)
    const token = makeAdminToken({ sub: IDS.user })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearerAuth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: IDS.user, nome: 'João Silva' })
  })

  it('404 — usuário do token foi deletado', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)
    const token = makeAdminToken({ sub: 'ghost-user-id' })

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearerAuth(token),
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('200 — cria novo usuário e devolve tokens', async () => {
    const createdUser = {
      id: 'new-user-999',
      nome: 'Novo Usuário',
      emailPessoal: 'novo@example.com',
      emailEducacional: null,
      ra: null,
      papel: 'USUARIO',
      ativo: true,
      precisaTrocarSenha: false,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    }
    // Inside $transaction: findUnique returns null (email free), create returns user
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)
    prismaMock.usuario.create.mockResolvedValueOnce(createdUser)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Novo Usuário',
        email: 'novo@example.com',
        password: 'Test@1234',
        role: 'USUARIO',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('accessToken')
    expect(body.user).toMatchObject({ emailPessoal: 'novo@example.com' })
  })

  it('409 — e-mail já em uso', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce({ id: 'existing-id' })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Duplicado',
        email: 'joao@example.com',
        password: 'Test@1234',
        role: 'USUARIO',
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toHaveProperty('error', 'Email já está em uso')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  it('200 — logout bem-sucedido', async () => {
    prismaMock.sessao.findFirst.mockResolvedValueOnce({ id: 'session-001' })
    prismaMock.sessao.update.mockResolvedValueOnce({})

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: 'some-valid-refresh-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('message', 'Logout OK')
  })
})
