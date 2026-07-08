/**
 * Segurança: troca de senha autenticada (POST /auth/trocar-senha)
 * Exige a senha atual (reautenticação) antes de gravar a nova, e revoga as
 * demais sessões. Também cobre o bloqueio de 'senha' no PATCH /usuarios do aluno.
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

describe('POST /auth/trocar-senha', () => {
  it('200 — troca a senha quando a senha atual confere', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ id: IDS.user, senhaHash: 'hash-atual' })
    prismaMock.usuario.update.mockResolvedValue({ id: IDS.user })
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 2 })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/trocar-senha',
      headers: bearerAuth(alunoToken),
      payload: { senhaAtual: 'atual-correta', novaSenha: SENHA_FORTE },
    })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalled()
    // Revoga as demais sessões após a troca.
    expect(prismaMock.sessao.updateMany).toHaveBeenCalled()
  })

  it('400 — senha atual incorreta não altera nada', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ id: IDS.user, senhaHash: 'hash-atual' })
    vi.mocked(passwordModule.verifyPassword).mockResolvedValue(false)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/trocar-senha',
      headers: bearerAuth(alunoToken),
      payload: { senhaAtual: 'errada', novaSenha: SENHA_FORTE },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('400 — nova senha fraca é rejeitada pela validação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/trocar-senha',
      headers: bearerAuth(alunoToken),
      payload: { senhaAtual: 'atual-correta', novaSenha: 'fraca' },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/trocar-senha',
      payload: { senhaAtual: 'x', novaSenha: SENHA_FORTE },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /usuarios/:id — aluno não troca senha sem reautenticar', () => {
  it('403 — aluno não pode enviar "senha" via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
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
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoToken),
      payload: { nome: 'Novo Nome' },
    })

    expect(res.statusCode).toBe(200)
  })
})
