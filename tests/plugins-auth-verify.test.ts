import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import authVerify from '../src/plugins/auth-verify'
import { registerProblemHandler } from '../src/hateoas'
import { generateAccessToken } from '../src/utils/jwt'
import { bearerAuth } from './helpers/auth'

const app = Fastify()

beforeAll(async () => {
  registerProblemHandler(app)
  await app.register(authVerify)
  app.get('/privada', { preHandler: app.authenticate }, async (req) => ({ sub: req.user?.sub }))
  app.get('/admin', { preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])] }, async () => ({ ok: true }))
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

const token = (role: string) => generateAccessToken({ sub: 'u-1', email: 'u@test.com', role })

describe('authenticate', () => {
  it('sem header: 401 problem+json com WWW-Authenticate: Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/privada' })
    expect(res.statusCode).toBe(401)
    expect(String(res.headers['content-type'])).toContain('application/problem+json')
    expect(res.headers['www-authenticate']).toBe('Bearer')
    expect(res.json()).toMatchObject({ type: '/errors/unauthorized', status: 401, instance: '/privada' })
  })

  it('header sem token ("Bearer "): trata como ausente', async () => {
    const res = await app.inject({ method: 'GET', url: '/privada', headers: { authorization: 'Bearer ' } })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
  })

  it('token inválido: invalid_token', async () => {
    const res = await app.inject({ method: 'GET', url: '/privada', headers: bearerAuth('nao-e-jwt') })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"')
  })

  it('token expirado: invalid_token', async () => {
    const expirado = generateAccessToken({ sub: 'u-1', email: 'u@test.com', role: 'USUARIO' }, { expiresIn: -60 })
    const res = await app.inject({ method: 'GET', url: '/privada', headers: bearerAuth(expirado) })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"')
  })

  it('token válido: preenche req.user', async () => {
    const res = await app.inject({ method: 'GET', url: '/privada', headers: bearerAuth(token('USUARIO')) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sub: 'u-1' })
  })

  it('não vaza o motivo interno no corpo do erro', async () => {
    const res = await app.inject({ method: 'GET', url: '/privada', headers: bearerAuth('nao-e-jwt') })
    expect(JSON.stringify(res.json())).not.toContain('jwt')
  })
})

describe('authorize', () => {
  it('papel permitido: 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin', headers: bearerAuth(token('ADMINISTRADOR')) })
    expect(res.statusCode).toBe(200)
  })

  it('papel insuficiente: 403 problem+json, sem WWW-Authenticate', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin', headers: bearerAuth(token('USUARIO')) })
    expect(res.statusCode).toBe(403)
    expect(String(res.headers['content-type'])).toContain('application/problem+json')
    expect(res.json()).toMatchObject({ type: '/errors/forbidden', title: 'Acesso negado' })
    expect(res.headers).not.toHaveProperty('www-authenticate')
  })

  it('sem login: o authenticate barra antes (401, não 403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin' })
    expect(res.statusCode).toBe(401)
  })
})
