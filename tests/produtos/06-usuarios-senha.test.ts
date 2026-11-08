/**
 * Segurança: o aluno não troca a senha pelo PATCH /users/:id.
 * Trocar a senha exige a senha atual: PUT /users/me/password (tests/core/sessions).
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
import { makeUser, IDS } from '../helpers/factories'
import { makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'
import * as passwordModule from '../../src/security/password'

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
  vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true)
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:nova')
})

const SENHA_FORTE = 'NovaSenha1#'

describe('PATCH /users/:id — aluno não troca senha sem reautenticar', () => {
  it('403 — aluno não pode enviar "senha" via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${IDS.user}`,
      headers: bearerAuth(alunoToken),
      payload: { senha: SENHA_FORTE },
    })

    expect(res.statusCode).toBe(403)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('200 — aluno ainda edita dados não sensíveis', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(makeUser({ id: IDS.user }))
    prismaMock.usuario.update.mockResolvedValue(makeUser({ id: IDS.user, nome: 'Novo Nome' }))

    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${IDS.user}`,
      headers: bearerAuth(alunoToken),
      payload: { nome: 'Novo Nome' },
    })

    expect(res.statusCode).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
