/**
 * Preferência de notificações in-app (usuario.notificacoesInApp).
 * - notifyMany só cria notificação para quem optou por receber.
 * - PATCH /usuarios/:id permite o aluno ligar/desligar a própria preferência.
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
import { notifyMany } from '../../src/core/notifications/notify'
import { makeUser, IDS } from '../helpers/factories'
import { makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let alunoToken: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  alunoToken = makeUserToken({ sub: IDS.user, role: 'USUARIO' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
})

describe('notifyMany — respeita a preferência', () => {
  it('só cria notificação para usuários com notificacoesInApp=true', async () => {
    // Pedimos para notificar A e B, mas o banco só retorna A como opt-in.
    prismaMock.usuario.findMany.mockResolvedValue([{ id: 'user-A' }])
    prismaMock.notificacao.createMany.mockResolvedValue({ count: 1 })

    await notifyMany(prismaMock as any, ['user-A', 'user-B'], {
      titulo: 'x', mensagem: 'y', tipo: 'SISTEMA',
    })

    expect(prismaMock.notificacao.createMany).toHaveBeenCalledTimes(1)
    const arg = prismaMock.notificacao.createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(1)
    expect(arg.data[0].usuarioId).toBe('user-A')
  })

  it('não cria nada quando ninguém optou por receber', async () => {
    prismaMock.usuario.findMany.mockResolvedValue([])

    await notifyMany(prismaMock as any, ['user-A', 'user-B'], {
      titulo: 'x', mensagem: 'y', tipo: 'SISTEMA',
    })

    expect(prismaMock.notificacao.createMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /usuarios/:id — aluno gerencia a própria preferência', () => {
  it('200 — aluno desliga notificacoesInApp no próprio cadastro', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(makeUser({ id: IDS.user }))
    prismaMock.usuario.update.mockResolvedValue(makeUser({ id: IDS.user, notificacoesInApp: false }))

    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoToken),
      payload: { notificacoesInApp: false },
    })

    expect(res.statusCode).toBe(200)
    const arg = prismaMock.usuario.update.mock.calls[0][0]
    expect(arg.data).toMatchObject({ notificacoesInApp: false })
  })
})
