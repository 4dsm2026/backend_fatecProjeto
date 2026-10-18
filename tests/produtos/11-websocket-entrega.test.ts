/**
 * O WebSocket não pode ter envio para "todos os conectados": cada evento
 * carrega dados de um chamado e só pode chegar a quem participa dele.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

import { buildApp } from '../../src/app'

let app: FastifyInstance

beforeAll(async () => {
  delete (globalThis as any).broadcastWS
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('WebSocket — entrega de eventos', () => {
  it('não expõe envio para todos os conectados', () => {
    expect((globalThis as any).broadcastWS).toBeUndefined()
  })

  it('expõe envio direcionado por usuário', () => {
    expect(typeof (globalThis as any).sendToUsersWS).toBe('function')
  })

  it('envio direcionado para usuários sem conexão aberta não falha', () => {
    expect(() =>
      (globalThis as any).sendToUsersWS(['ninguem-conectado'], { type: 'nova_mensagem' }),
    ).not.toThrow()
  })
})
