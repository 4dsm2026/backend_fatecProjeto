/**
 * Rotas que NÃO podem existir.
 *
 * POST /auth/register era público (sem autenticação), aceitava `role` no corpo,
 * gravava em `papel` e devolvia tokens: qualquer pessoa criava uma conta
 * ADMINISTRADOR. GET /auth/usuarios deixava qualquer usuário logado listar todos
 * os usuários. A única rota de criação de conta é POST /users, restrita a admin.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { bearerAuth, makeUserToken } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

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
  prismaMock.usuario.findUnique.mockResolvedValue(null)
  prismaMock.usuario.findMany.mockResolvedValue([])
  prismaMock.usuario.create.mockImplementation(async (a: any) => ({ id: 'novo', ...a.data, ativo: true }))
  prismaMock.sessao.create.mockResolvedValue({ id: 's1' })
})

const ataque = { email: 'atacante@example.com', password: 'Qualquer123!', role: 'ADMINISTRADOR', name: 'Atacante' }

describe('POST /auth/register não existe (era uma porta aberta para criar ADMINISTRADOR)', () => {
  it('sem token e com role ADMINISTRADOR: 404, nenhuma conta criada, nenhum token devolvido', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: ataque })

    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('accessToken')
    expect(prismaMock.usuario.create).not.toHaveBeenCalled()
    expect(prismaMock.sessao.create).not.toHaveBeenCalled()
  })

  it.each(['USUARIO', 'ADMINISTRADOR'] as const)('nem logado como %s a rota volta', async (papel) => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: bearerAuth(makeUserToken({ role: papel })),
      payload: ataque,
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.usuario.create).not.toHaveBeenCalled()
  })
})

describe('GET /auth/usuarios não existe (listava usuários para qualquer pessoa logada)', () => {
  it.each([
    ['sem token', undefined],
    ['aluno', 'USUARIO'],
    ['administrador', 'ADMINISTRADOR'],
  ] as const)('%s: 404 e nenhuma consulta de usuários', async (_nome, papel) => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/usuarios',
      headers: papel ? bearerAuth(makeUserToken({ role: papel })) : undefined,
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.usuario.findMany).not.toHaveBeenCalled()
  })
})

/**
 * O módulo legado /auth foi substituído por recursos (POST /sessions, POST /tokens,
 * PUT /users/me/password, POST|PUT /password-resets, PUT /account-activations,
 * DELETE /sessions/current, GET /users/me). Nenhuma rota antiga pode voltar.
 */
describe('as rotas legadas de /auth foram substituídas e não existem mais', () => {
  it.each([
    ['POST', '/auth/login', 'POST /sessions'],
    ['POST', '/auth/refresh', 'POST /tokens'],
    ['POST', '/auth/logout', 'DELETE /sessions/current'],
    ['GET', '/auth/me', 'GET /users/me'],
    ['POST', '/auth/trocar-senha', 'PUT /users/me/password'],
    ['POST', '/auth/esqueci-senha', 'POST /password-resets'],
    ['POST', '/auth/reset-senha', 'PUT /password-resets/:token'],
    ['POST', '/auth/primeiro-acesso', 'PUT /account-activations/:token'],
  ] as const)('%s %s → 404 (agora: %s)', async (method, url) => {
    const res = await app.inject({
      method,
      url,
      headers: bearerAuth(makeUserToken({ role: 'ADMINISTRADOR' })),
      payload: method === 'POST' ? { email: 'a@example.com', password: 'Qualquer123!', token: 'x'.repeat(20) } : undefined,
    })

    expect(res.statusCode).toBe(404)
    expect(String(res.headers['content-type'])).toContain('application/problem+json')
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.create).not.toHaveBeenCalled()
  })

  it('nenhuma rota sob /auth sobrou no OpenAPI', async () => {
    const paths = Object.keys((app as any).swagger().paths).filter((p) => p.startsWith('/auth'))

    expect(paths).toEqual([])
  })
})
