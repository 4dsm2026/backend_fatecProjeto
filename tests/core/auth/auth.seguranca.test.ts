/**
 * Endurecimento do módulo auth (sem mudar contrato HTTP):
 *  - claim `sid` no access token (login e refresh)
 *  - refresh só renova sessão válida, de usuário ativo e não apagado (S12/S13)
 *  - login gasta uma verificação de hash também para conta inexistente/sem hash
 *  - esqueci-senha responde igual exista a conta ou não, mesmo se o envio falhar (S16)
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/app'
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { makeLoginUser, IDS } from '../../helpers/factories'
import { resetMocks } from '../../helpers/reset'
import { verifyAccessToken } from '../../../src/utils/jwt'
import * as passwordModule from '../../../src/security/password'

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
  vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true)
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:password')
  prismaMock.loginTentativa.create.mockResolvedValue({})
  prismaMock.sessao.create.mockResolvedValue({ id: 'session-001' })
  prismaMock.usuario.update.mockResolvedValue(makeLoginUser())
})

const login = (payload: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/auth/login', payload })

// ─────────────────────────────────────────────────────────────────────────────
describe('sid no access token', () => {
  it('login: o access token carrega o id da sessão criada', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser())

    const res = await login({ email: 'joao@example.com', password: 'Test@1234' })

    expect(res.statusCode).toBe(200)
    expect(verifyAccessToken(res.json().accessToken).sid).toBe('session-001')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/refresh', () => {
  const refreshToken = 'r'.repeat(40)
  const sessao = { id: 'sess-1', usuarioId: IDS.user }
  const userOk = { id: IDS.user, emailPessoal: 'joao@example.com', papel: 'USUARIO', ativo: true, deletadoEm: null }
  const refresh = () => app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })

  it('200 — rotaciona o refresh e o novo access token carrega o sid da MESMA sessão', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessao)
    prismaMock.usuario.findUnique.mockResolvedValue(userOk)
    prismaMock.sessao.update.mockResolvedValue({})

    const res = await refresh()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.refreshToken).not.toBe(refreshToken)
    expect(verifyAccessToken(body.accessToken)).toMatchObject({ sub: IDS.user, sid: 'sess-1' })
  })

  it('só procura sessão não revogada E não expirada (S12)', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(null)

    await refresh()

    expect(prismaMock.sessao.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ revogadaEm: null, expiraEm: { gt: expect.any(Date) } }),
    })
  })

  it('401 — sessão inexistente, revogada ou expirada', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(null)

    const res = await refresh()

    expect(res.statusCode).toBe(401)
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled()
  })

  it('401 — usuário desativado não renova e a sessão é revogada (S13)', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessao)
    prismaMock.usuario.findUnique.mockResolvedValue({ ...userOk, ativo: false })
    prismaMock.sessao.update.mockResolvedValue({})

    const res = await refresh()

    expect(res.statusCode).toBe(401)
    expect(prismaMock.sessao.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { revogadaEm: expect.any(Date) },
    })
  })

  it('401 — usuário apagado (soft delete) não renova', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessao)
    prismaMock.usuario.findUnique.mockResolvedValue({ ...userOk, deletadoEm: new Date() })
    prismaMock.sessao.update.mockResolvedValue({})

    expect((await refresh()).statusCode).toBe(401)
  })

  it('401 (e não 500) — usuário da sessão não existe mais', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessao)
    prismaMock.usuario.findUnique.mockResolvedValue(null)
    prismaMock.sessao.update.mockResolvedValue({})

    expect((await refresh()).statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('login — tempo igual para conta inexistente (verificação de hash sempre acontece)', () => {
  it('conta inexistente: 401 e UMA verificação de hash', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await login({ email: 'fantasma@example.com', password: 'Test@1234' })

    expect(res.statusCode).toBe(401)
    expect(passwordModule.verifyPassword).toHaveBeenCalledTimes(1)
    expect(passwordModule.verifyPassword).toHaveBeenCalledWith(expect.any(String), 'Test@1234')
  })

  it('conta sem hash de senha: 401 e UMA verificação de hash', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ senhaHash: null }))

    const res = await login({ email: 'joao@example.com', password: 'Test@1234' })

    expect(res.statusCode).toBe(401)
    expect(passwordModule.verifyPassword).toHaveBeenCalledTimes(1)
  })

  it('conta existente com senha errada: também UMA verificação (mesmo custo)', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser())
    vi.mocked(passwordModule.verifyPassword).mockResolvedValue(false)

    const res = await login({ email: 'joao@example.com', password: 'Errada@123' })

    expect(res.statusCode).toBe(401)
    expect(passwordModule.verifyPassword).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/esqueci-senha — não revela se o e-mail existe (S16)', () => {
  const MSG = 'Se existir uma conta com esse e-mail, enviaremos um link para redefinir a senha.'
  const esqueci = () =>
    app.inject({ method: 'POST', url: '/auth/esqueci-senha', payload: { email: 'joao@example.com' } })
  const conta = { id: IDS.user, nome: 'João', emailPessoal: 'joao@example.com', emailEducacional: null }

  it('conta existe e o e-mail é enviado: 200 com a mensagem padrão', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue(conta)
    prismaMock.tokenResetSenha.create.mockResolvedValue({ id: 'tok-1' })
    mockSend.mockResolvedValue(undefined)

    const res = await esqueci()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ message: MSG })
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
  })

  it('conta existe mas o ENVIO FALHA: continua 200 com a mesma mensagem (antes era 500)', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue(conta)
    prismaMock.tokenResetSenha.create.mockResolvedValue({ id: 'tok-1' })
    mockSend.mockRejectedValue(new Error('SES indisponível'))

    const res = await esqueci()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ message: MSG })
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
  })

  it('conta não existe: 200 com a mesma mensagem e nenhum e-mail enviado', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue(null)

    const res = await esqueci()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ message: MSG })
    await vi.waitFor(() => expect(prismaMock.usuario.findFirst).toHaveBeenCalled())
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('falha do banco: continua 200 com a mesma mensagem', async () => {
    prismaMock.usuario.findFirst.mockRejectedValue(new Error('db fora'))

    const res = await esqueci()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ message: MSG })
  })

  it('400 — e-mail inválido continua sendo erro de validação', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/esqueci-senha', payload: { email: 'nao-e-email' } })
    expect(res.statusCode).toBe(400)
  })
})
