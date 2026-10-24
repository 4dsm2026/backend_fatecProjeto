/**
 * PUT /account-activations/:token (primeiro acesso).
 *
 * O repositório de tokens APLICA o where do findFirst e dos updateMany sobre linhas
 * de verdade: finalidade, replay, corrida e invalidação dos tokens irmãos são
 * testados por comportamento, e não só pela forma das chamadas.
 */
import { createHash } from 'node:crypto'
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:nova'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../../src/security/dummy-verify', () => ({ verifyDummyPassword: vi.fn().mockResolvedValue(undefined) }))
const mockSend = vi.fn()
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/app'
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import * as passwordModule from '../../../src/security/password'
import { IDS, makeLoginUser } from '../../helpers/factories'
import { resetMocks } from '../../helpers/reset'

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>
type Finalidade = 'RESET_SENHA' | 'PRIMEIRO_ACESSO'
type Linha = {
  id: string
  usuarioId: string
  tokenHash: string
  finalidade: Finalidade
  expiraEm: Date
  usadoEm: Date | null
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const TOKEN = 'ativacao-token-cru-0123456789abcdef'
const TOKEN_RESET = 'reset-token-cru-0123456789abcdef'
const SENHA = 'NovaSenha1#'
const daqui = (ms: number) => new Date(Date.now() + ms)
const OUTRO_USUARIO = 'user-id-999'

const donoPadrao = { id: IDS.user, ativo: true, deletadoEm: null as Date | null, precisaTrocarSenha: true }
let dono = donoPadrao
let rows: Linha[]

function linha(id: string, raw: string, finalidade: Finalidade, usuarioId = IDS.user): Linha {
  return { id, usuarioId, tokenHash: sha256(raw), finalidade, expiraEm: daqui(86_400_000), usadoEm: null }
}

function casa(r: Linha, w: any): boolean {
  return (
    (w.id === undefined || r.id === w.id) &&
    (w.usuarioId === undefined || r.usuarioId === w.usuarioId) &&
    (w.tokenHash === undefined || r.tokenHash === w.tokenHash) &&
    (w.finalidade === undefined || r.finalidade === w.finalidade) &&
    (w.usadoEm === undefined || r.usadoEm === w.usadoEm) &&
    (w.expiraEm?.gt === undefined || r.expiraEm > w.expiraEm.gt)
  )
}

function instalarRepositorio() {
  prismaMock.tokenResetSenha.findFirst.mockImplementation(async (args: any) => {
    const r = rows.find((x) => casa(x, args.where))
    return r ? { ...r, usuario: dono } : null
  })
  prismaMock.tokenResetSenha.updateMany.mockImplementation(async (args: any) => {
    const alvos = rows.filter((x) => casa(x, args.where))
    for (const r of alvos) Object.assign(r, args.data)
    return { count: alvos.length }
  })
}

function expectProblem(res: InjectResponse, status: number) {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toContain('application/problem+json')
  const body = res.json<{ status: number; title?: string; errors?: Array<{ field: string }>; [k: string]: unknown }>()
  expect(body.status).toBe(status)
  expect(body).not.toHaveProperty('error')
  return body
}

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
  mockSend.mockReset()
  vi.mocked(passwordModule.hashPassword).mockReset()
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:nova')
  vi.mocked(passwordModule.verifyPassword).mockReset()
  vi.mocked(passwordModule.verifyPassword).mockResolvedValue(true)
  dono = { ...donoPadrao }
  rows = [linha('t-ativ', TOKEN, 'PRIMEIRO_ACESSO'), linha('t-reset', TOKEN_RESET, 'RESET_SENHA')]
  instalarRepositorio()
  prismaMock.usuario.findUnique.mockResolvedValue(null) // ninguém usa o e-mail pedido
  prismaMock.usuario.update.mockResolvedValue({ id: IDS.user })
})

describe('PUT /account-activations/:token', () => {
  const ativar = (token: string, payload: unknown = { novaSenha: SENHA }, headers: Record<string, string> = {}) =>
    app.inject({ method: 'PUT', url: `/account-activations/${token}`, payload: payload as never, headers })

  function nadaMudou() {
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(passwordModule.hashPassword).not.toHaveBeenCalled()
    expect(rows.every((r) => r.usadoEm === null)).toBe(true)
  }

  it('204 — sem corpo, sem cookie, sem sessão; define a senha e libera a conta', async () => {
    const res = await ativar(TOKEN)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(prismaMock.sessao.create).not.toHaveBeenCalled()
    expect(passwordModule.hashPassword).toHaveBeenCalledWith(SENHA)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: IDS.user },
      data: { senhaHash: 'hashed:nova', precisaTrocarSenha: false, passwordUpdatedAt: expect.any(Date) },
    })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('204 — registra a auditoria primeiro_acesso_sucesso', async () => {
    await ativar(TOKEN)

    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: { feitoPorId: IDS.user, acao: 'primeiro_acesso_sucesso', alvo: IDS.user, meta: {} },
    })
  })

  it('204 — com emailPessoal: grava o novo e-mail', async () => {
    const res = await ativar(TOKEN, { novaSenha: SENHA, emailPessoal: 'novo@example.com' })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.usuario.findUnique).toHaveBeenCalledWith({ where: { emailPessoal: 'novo@example.com' }, select: { id: true } })
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: IDS.user },
      data: expect.objectContaining({ emailPessoal: 'novo@example.com' }),
    })
  })

  it('204 — o e-mail pedido já é do próprio usuário: segue normalmente', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ id: IDS.user })

    const res = await ativar(TOKEN, { novaSenha: SENHA, emailPessoal: 'meu@example.com' })

    expect(res.statusCode).toBe(204)
  })

  it('é público: funciona sem Authorization e ignora um Bearer inválido', async () => {
    const res = await ativar(TOKEN, { novaSenha: SENHA }, { authorization: 'Bearer lixo' })

    expect(res.statusCode).toBe(204)
  })

  it('INVALIDA os outros tokens de primeiro acesso pendentes do usuário (e só eles)', async () => {
    rows.push(
      linha('t-ativ-2', 'outro-token-de-login-0123456789', 'PRIMEIRO_ACESSO'),
      linha('t-ativ-3', 'mais-um-token-de-login-0123456789', 'PRIMEIRO_ACESSO'),
      linha('t-ativ-alheio', 'token-de-outro-usuario-0123456789', 'PRIMEIRO_ACESSO', OUTRO_USUARIO),
    )

    expect((await ativar(TOKEN)).statusCode).toBe(204)

    const usado = (id: string) => rows.find((r) => r.id === id)?.usadoEm
    expect(usado('t-ativ')).toBeInstanceOf(Date)
    expect(usado('t-ativ-2')).toBeInstanceOf(Date)
    expect(usado('t-ativ-3')).toBeInstanceOf(Date)
    expect(usado('t-reset')).toBeNull() // outra finalidade, intacto
    expect(usado('t-ativ-alheio')).toBeNull() // outro usuário, intacto
  })

  it('REPLAY: o mesmo token de novo dá 409 e nada é gravado outra vez', async () => {
    expect((await ativar(TOKEN)).statusCode).toBe(204)
    prismaMock.usuario.update.mockClear()

    const segunda = await ativar(TOKEN, { novaSenha: 'OutraSenha2$' })

    expectProblem(segunda, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('um token IRMÃO, depois da ativação, também deixa de valer (409)', async () => {
    rows.push(linha('t-ativ-2', 'outro-token-de-login-0123456789', 'PRIMEIRO_ACESSO'))
    await ativar(TOKEN)
    prismaMock.usuario.update.mockClear()

    const res = await ativar('outro-token-de-login-0123456789')

    expectProblem(res, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('CORRIDA: se o token foi consumido entre a leitura e a gravação, 409 e nada muda', async () => {
    const original = prismaMock.tokenResetSenha.updateMany.getMockImplementation()!
    prismaMock.tokenResetSenha.updateMany.mockImplementation(async (args: any) =>
      args.where.id ? { count: 0 } : original(args),
    )

    const res = await ativar(TOKEN)

    expectProblem(res, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('CORRIDA REAL: leitura desatualizada (outra requisição consome o token logo após a leitura)', async () => {
    const leitura = prismaMock.tokenResetSenha.findFirst.getMockImplementation()!
    prismaMock.tokenResetSenha.findFirst.mockImplementation(async (args: any) => {
      const lida = await leitura(args)
      rows[0].usadoEm = new Date()
      return lida
    })

    const res = await ativar(TOKEN)

    expectProblem(res, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('409 — token já usado (ainda dentro da validade)', async () => {
    rows[0].usadoEm = new Date(Date.now() - 60_000)

    expectProblem(await ativar(TOKEN), 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  describe('409 — e-mail pessoal de OUTRA conta', () => {
    it('recusa, não troca senha e não consome o token', async () => {
      prismaMock.usuario.findUnique.mockResolvedValue({ id: OUTRO_USUARIO })

      const res = await ativar(TOKEN, { novaSenha: SENHA, emailPessoal: 'ocupado@example.com' })

      const body = expectProblem(res, 409)
      expect(body.title).toBe('Este e-mail pessoal já está em uso')
      expect(body.type).toBe('/errors/email-already-in-use')
      nadaMudou()
    })

    it('o 409 de "token já usado" NÃO leva esse type (o cliente os distingue por ele)', async () => {
      rows[0].usadoEm = new Date(Date.now() - 60_000)

      const body = expectProblem(await ativar(TOKEN), 409)

      expect(body.type).not.toBe('/errors/email-already-in-use')
    })
  })

  describe('404 — token que "não existe" para este fluxo', () => {
    it('token inexistente', async () => {
      expect(expectProblem(await ativar('nao-existe-0123456789'), 404).title).toBe('Token inválido ou expirado')
      nadaMudou()
    })

    it('token expirado', async () => {
      rows[0].expiraEm = new Date(Date.now() - 1000)
      expectProblem(await ativar(TOKEN), 404)
      nadaMudou()
    })

    it('token de RESET_SENHA não ativa conta (S19) nem troca o e-mail', async () => {
      expectProblem(await ativar(TOKEN_RESET, { novaSenha: SENHA, emailPessoal: 'novo@example.com' }), 404)
      nadaMudou()
    })

    it('conta apagada (soft delete)', async () => {
      dono.deletadoEm = new Date()
      expectProblem(await ativar(TOKEN), 404)
      nadaMudou()
    })

    it('conta que já concluiu o primeiro acesso (precisaTrocarSenha = false)', async () => {
      dono.precisaTrocarSenha = false
      expectProblem(await ativar(TOKEN), 404)
      nadaMudou()
    })
  })

  it('403 — conta inativa: nada é alterado', async () => {
    dono.ativo = false

    const body = expectProblem(await ativar(TOKEN), 403)

    expect(body.title).toBe('Usuário inativo')
    nadaMudou()
  })

  it.each([
    ['curta', 'Ab1#xyz'],
    ['sem maiúscula', 'novasenha1#'],
    ['sem símbolo', 'NovaSenha12'],
  ])('400 — senha %s: erro em novaSenha e o banco nem é consultado', async (_nome, senha) => {
    const body = expectProblem(await ativar(TOKEN, { novaSenha: senha }), 400)

    expect(body.errors?.some((e) => e.field === 'novaSenha')).toBe(true)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('400 — e-mail pessoal inválido', async () => {
    const body = expectProblem(await ativar(TOKEN, { novaSenha: SENHA, emailPessoal: 'isto-nao-e-email' }), 400)

    expect(body.errors?.some((e) => e.field === 'emailPessoal')).toBe(true)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('400 — sem corpo', async () => {
    expectProblem(await app.inject({ method: 'PUT', url: `/account-activations/${TOKEN}` }), 400)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('400 — campos antigos (newPassword/personalEmail): o contrato agora é novaSenha/emailPessoal', async () => {
    expectProblem(await ativar(TOKEN, { newPassword: SENHA, personalEmail: 'novo@example.com' }), 400)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('500 — falha inesperada do banco não vaza a mensagem', async () => {
    prismaMock.tokenResetSenha.findFirst.mockRejectedValue(new Error('segredo-interno'))

    const res = await ativar(TOKEN)

    expectProblem(res, 500)
    expect(res.body).not.toContain('segredo-interno')
  })
})

describe('contrato: login → link activate → ativação', () => {
  it('segue o link que o servidor devolveu no 403 e conclui; o mesmo link depois dá 409', async () => {
    rows = []
    dono = { ...donoPadrao, id: IDS.user }
    prismaMock.loginTentativa.create.mockResolvedValue({})
    prismaMock.tokenResetSenha.create.mockImplementation(async (args: any) => {
      rows.push({ id: 't-do-login', usadoEm: null, ...args.data })
      return {}
    })
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeLoginUser({ precisaTrocarSenha: true }))

    const login = await app.inject({ method: 'POST', url: '/sessions', payload: { email: 'joao@example.com', password: 'Fatec@2026' } })
    expectProblem(login, 403)
    const activate = login.json<{ _links: { activate: { href: string; method: string } } }>()._links.activate

    const ativacao = await app.inject({ method: activate.method, url: activate.href, payload: { novaSenha: SENHA } })
    expect(ativacao.statusCode).toBe(204)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: IDS.user },
      data: expect.objectContaining({ senhaHash: 'hashed:nova', precisaTrocarSenha: false }),
    })

    const denovo = await app.inject({ method: activate.method, url: activate.href, payload: { novaSenha: 'OutraSenha2$' } })
    expectProblem(denovo, 409)
  })
})
