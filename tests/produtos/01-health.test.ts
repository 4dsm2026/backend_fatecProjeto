/**
 * Produto: Saúde do serviço
 * Cobre: GET /health. (As rotas de autenticação vivem em tests/core/sessions.)
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// Must be hoisted before any src/ import that touches Prisma
vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
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
