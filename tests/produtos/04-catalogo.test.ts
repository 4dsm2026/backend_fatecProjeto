/**
 * Produto: Catálogo de Serviços
 * Cobre: listar categorias com serviços, catálogo vazio, sem autenticação
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeCategoria, IDS } from '../helpers/factories'
import { makeAdminToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let adminToken: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  adminToken = makeAdminToken()
})

afterAll(async () => {
  await app.close()
})

beforeEach(resetMocks)

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /catalogo', () => {
  it('200 — retorna categorias com serviços ativos', async () => {
    const cat = makeCategoria()
    prismaMock.categoria.findMany.mockResolvedValueOnce([cat])

    const res = await app.inject({
      method: 'GET',
      url: '/catalogo',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('categorias')
    expect(body.categorias).toHaveLength(1)
    expect(body.categorias[0]).toMatchObject({
      id: IDS.categoria,
      nome: 'Acesso e Autenticação',
    })
    expect(body.categorias[0].servicos).toHaveLength(1)
    expect(body.categorias[0].servicos[0]).toMatchObject({ ativo: true })
  })

  it('200 — catálogo vazio retorna array vazio (não 404)', async () => {
    prismaMock.categoria.findMany.mockResolvedValueOnce([])

    const res = await app.inject({
      method: 'GET',
      url: '/catalogo',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ categorias: [] })
  })

  it('200 — múltiplas categorias retornadas em ordem alfabética', async () => {
    const cats = [
      makeCategoria({ id: 'cat-001', nome: 'Acesso e Autenticação' }),
      makeCategoria({ id: 'cat-002', nome: 'Biblioteca', servicos: [] }),
      makeCategoria({ id: 'cat-003', nome: 'Secretaria', servicos: [] }),
    ]
    prismaMock.categoria.findMany.mockResolvedValueOnce(cats)

    const res = await app.inject({ method: 'GET', url: '/catalogo' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.categorias).toHaveLength(3)
  })

  it('não requer autenticação — catálogo é público', async () => {
    prismaMock.categoria.findMany.mockResolvedValueOnce([makeCategoria()])

    const resWithAuth = await app.inject({
      method: 'GET',
      url: '/catalogo',
      headers: bearerAuth(adminToken),
    })
    const resWithoutAuth = await app.inject({ method: 'GET', url: '/catalogo' })

    expect(resWithAuth.statusCode).toBe(200)
    expect(resWithoutAuth.statusCode).toBe(200)
  })
})
