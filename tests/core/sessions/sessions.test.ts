/**
 * GET /sessions/current, DELETE /sessions/current e GET /users/me:
 * status, problem+json, WWW-Authenticate, links por papel.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))
vi.mock('../../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hash-nova'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/app'
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { generateAccessToken } from '../../../src/utils/jwt'
import * as passwordModule from '../../../src/security/password'
import { bearerAuth } from '../../helpers/auth'
import { resetMocks } from '../../helpers/reset'
import type { TestRole } from '../../helpers/auth'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
beforeEach(() => resetMocks())

const USER_ID = 'user-id-001'
const tokenWith = (role: TestRole, sid = 'sess-1') =>
  generateAccessToken({ sub: USER_ID, email: 'u@test.com', role, sid })

/** Token emitido antes da claim `sid` existir (sem sessão associada). */
const legacyToken = (role: TestRole) => generateAccessToken({ sub: USER_ID, email: 'u@test.com', role })

const sessaoAtiva = {
  id: 'sess-1',
  criadoEm: new Date('2026-10-13T10:00:00Z'),
  ultimoUsoEm: new Date('2026-10-13T10:05:00Z'),
  expiraEm: new Date('2026-10-20T10:00:00Z'),
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
}

const expectProblem = (res: { statusCode: number; headers: Record<string, unknown>; json: () => any }, status: number) => {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toContain('application/problem+json')
  expect(res.json()).toMatchObject({ status })
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /sessions/current', () => {
  const call = (token?: string) =>
    app.inject({ method: 'GET', url: '/sessions/current', headers: token ? bearerAuth(token) : {} })

  it('200 — devolve a sessão com os links de conta', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessaoAtiva)

    const res = await call(tokenWith('USUARIO'))

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ id: 'sess-1', ip: '203.0.113.9', userAgent: 'Mozilla/5.0' })
    expect(body._links).toMatchObject({
      self: { href: '/sessions/current', method: 'GET' },
      logout: { href: '/sessions/current', method: 'DELETE' },
      refresh: { href: '/tokens', method: 'POST' },
      user: { href: '/users/me', method: 'GET' },
    })
    expect(body).not.toHaveProperty('refreshHash')
  })

  it('só procura a sessão do PRÓPRIO usuário, não revogada e não expirada', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(sessaoAtiva)

    await call(tokenWith('USUARIO', 'sess-1'))

    expect(prismaMock.sessao.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', usuarioId: USER_ID, revogadaEm: null, expiraEm: { gt: expect.any(Date) } },
      }),
    )
  })

  it('401 — sem token: problem+json e WWW-Authenticate: Bearer', async () => {
    const res = await call()

    expectProblem(res, 401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
  })

  it('401 — token inválido: WWW-Authenticate com invalid_token', async () => {
    const res = await call('lixo.que.nao.e.jwt')

    expectProblem(res, 401)
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"')
  })

  it('401 — sessão revogada ou expirada, mesmo com access token ainda válido', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(null)

    const res = await call(tokenWith('USUARIO'))

    expectProblem(res, 401)
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"')
  })

  it('401 — token antigo, sem sid, não consulta o banco', async () => {
    const res = await call(legacyToken('USUARIO'))

    expectProblem(res, 401)
    expect(prismaMock.sessao.findFirst).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /sessions/current', () => {
  const call = (token?: string) =>
    app.inject({ method: 'DELETE', url: '/sessions/current', headers: token ? bearerAuth(token) : {} })

  it('204 — revoga a sessão do token (sem corpo)', async () => {
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 1 })

    const res = await call(tokenWith('USUARIO', 'sess-1'))

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(prismaMock.sessao.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', usuarioId: USER_ID, revogadaEm: null },
      data: { revogadaEm: expect.any(Date) },
    })
  })

  it('204 — idempotente: sessão que já estava revogada', async () => {
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 0 })

    expect((await call(tokenWith('USUARIO'))).statusCode).toBe(204)
  })

  it('401 — sem token', async () => {
    const res = await call()

    expectProblem(res, 401)
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
  })

  it('401 — token antigo, sem sid: não revoga nada', async () => {
    const res = await call(legacyToken('USUARIO'))

    expectProblem(res, 401)
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /users/me', () => {
  const call = (token?: string) =>
    app.inject({ method: 'GET', url: '/users/me', headers: token ? bearerAuth(token) : {} })
  const usuario = (papel: TestRole) => ({ id: USER_ID, nome: 'João', emailPessoal: 'u@test.com', papel, ativo: true })

  it.each<TestRole>(['USUARIO', 'BACKOFFICE', 'TECNICO', 'ADMINISTRADOR'])(
    '200 (%s) — dados do usuário e links de conta; self continua /users/me',
    async (papel) => {
      prismaMock.usuario.findUnique.mockResolvedValue(usuario(papel))

      const res = await call(tokenWith(papel))

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({ id: USER_ID, nome: 'João', papel })
      expect(body._links).toMatchObject({
        self: { href: '/users/me', method: 'GET' },
        update: { href: `/users/${USER_ID}`, method: 'PATCH' },
        password: { href: '/users/me/password', method: 'PUT' },
        logout: { href: '/sessions/current', method: 'DELETE' },
        entry: { href: '/api', method: 'GET' },
        tickets: { href: '/tickets' },
      })
    },
  )

  it('links de menu por papel: aluno não vê os de equipe nem de admin', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(usuario('USUARIO'))

    const { _links } = (await call(tokenWith('USUARIO'))).json()

    for (const rel of ['users', 'ticket-stats', 'sectors', 'roles', 'audit-logs', 'communication-templates']) {
      expect(_links).not.toHaveProperty(rel)
    }
  })

  it('links de menu por papel: equipe vê os de equipe, só admin vê os de admin', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(usuario('TECNICO'))
    const tecnico = (await call(tokenWith('TECNICO'))).json()._links
    expect(tecnico).toHaveProperty('users')
    expect(tecnico).toHaveProperty('ticket-stats')
    expect(tecnico).not.toHaveProperty('roles')

    prismaMock.usuario.findUnique.mockResolvedValue(usuario('ADMINISTRADOR'))
    const admin = (await call(tokenWith('ADMINISTRADOR'))).json()._links
    expect(admin).toHaveProperty('roles')
    expect(admin).toHaveProperty('audit-logs')
  })

  it('não repete os links que /users/me já tem (session, current-user)', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(usuario('USUARIO'))

    const { _links } = (await call(tokenWith('USUARIO'))).json()

    expect(_links).not.toHaveProperty('session')
    expect(_links).not.toHaveProperty('current-user')
  })

  it('só seleciona campos públicos (nunca senhaHash)', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(usuario('USUARIO'))

    await call(tokenWith('USUARIO'))

    const args = prismaMock.usuario.findUnique.mock.calls[0][0] as { where: unknown; select: Record<string, boolean> }
    expect(args.where).toEqual({ id: USER_ID })
    expect(args.select).not.toHaveProperty('senhaHash')
    expect(args.select.id).toBe(true)
  })

  it('404 problem+json — o usuário do token não existe mais', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null)

    expectProblem(await call(tokenWith('USUARIO')), 404)
  })

  it('401 — sem token', async () => {
    const res = await call()

    expectProblem(res, 401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /users/me/password', () => {
  const call = (token?: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/users/me/password',
      headers: token ? bearerAuth(token) : {},
      payload,
    })

  const user = {
    id: USER_ID,
    nome: 'João',
    senhaHash: 'hash-atual',
    emailPessoal: 'joao@example.com',
    emailEducacional: null,
  }

  beforeEach(() => {
    resetMocks()
    vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true)
    vi.mocked(passwordModule.hashPassword).mockResolvedValue('hash-nova')
    mockSend.mockResolvedValue(undefined)
  })

  it('204 — troca a senha do usuário autenticado e revoga TODAS as sessões ativas (inclusive a atual)', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    prismaMock.usuario.update.mockResolvedValue({ id: USER_ID })
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 2 })

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(passwordModule.verifyPassword).toHaveBeenCalledWith('hash-atual', 'Atual123!')
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { senhaHash: 'hash-nova', precisaTrocarSenha: false, passwordUpdatedAt: expect.any(Date) },
    })
    expect(prismaMock.sessao.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: USER_ID, revogadaEm: null },
      data: { revogadaEm: expect.any(Date) },
    })
  })

  it('400 — payload inválido', async () => {
    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'fraca' })

    expectProblem(res, 400)
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled()
  })

  it('422 — senha atual incorreta', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    vi.mocked(passwordModule.verifyPassword).mockResolvedValue(false)

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Errada123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 422)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('404 — usuário autenticado não existe mais', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null)

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 404)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
  })

  it('500 — falha na transação não persiste a troca', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    prismaMock.$transaction.mockRejectedValueOnce(new Error('DB falhou'))

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 500)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('204 — falha no envio do e-mail não reverte a troca', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    prismaMock.usuario.update.mockResolvedValue({ id: USER_ID })
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 2 })
    mockSend.mockRejectedValueOnce(new Error('SMTP indisponível'))

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.usuario.update).toHaveBeenCalled()
  })

  it('204 — registra a auditoria troca_senha_sucesso', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    prismaMock.usuario.update.mockResolvedValue({ id: USER_ID })
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 1 })

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: { feitoPorId: USER_ID, acao: 'troca_senha_sucesso', alvo: USER_ID, meta: {} },
    })
  })

  it('204 — avisa por e-mail o dono da conta, sem senha nenhuma no conteúdo', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    prismaMock.usuario.update.mockResolvedValue({ id: USER_ID })
    prismaMock.sessao.updateMany.mockResolvedValue({ count: 1 })

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expect(res.statusCode).toBe(204)
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    const aviso = mockSend.mock.calls[0][0]
    expect(aviso.to).toBe('joao@example.com')
    const conteudo = JSON.stringify(aviso)
    for (const segredo of ['Atual123!', 'NovaSenha1!', 'hash-nova', 'hash-atual']) {
      expect(conteudo).not.toContain(segredo)
    }
  })

  it('422 — registra troca_senha_falha e não revoga sessão nem envia e-mail', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(user)
    vi.mocked(passwordModule.verifyPassword).mockResolvedValue(false)

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Errada123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 422)
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: {
        feitoPorId: USER_ID,
        acao: 'troca_senha_falha',
        alvo: USER_ID,
        meta: { motivo: 'senha_atual_incorreta' },
      },
    })
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('409 — usuário sem senha local definida', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ ...user, senhaHash: null })

    const res = await call(tokenWith('USUARIO'), { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 409)
    expect(passwordModule.verifyPassword).not.toHaveBeenCalled()
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
  })

  it('401 — sem token', async () => {
    const res = await call(undefined, { senhaAtual: 'Atual123!', novaSenha: 'NovaSenha1!' })

    expectProblem(res, 401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
  })
})
