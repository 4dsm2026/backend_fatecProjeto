/**
 * POST /password-resets (pedir o link) e PUT /password-resets/:token (redefinir).
 *
 * O repositório de tokens abaixo APLICA o where do findFirst e do updateMany sobre
 * linhas de verdade, então replay, finalidade e corrida são testados por comportamento.
 */
import { createHash } from 'node:crypto'
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:nova'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))
const mockSend = vi.fn()
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/app'
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import * as passwordModule from '../../../src/security/password'
import { IDS } from '../../helpers/factories'
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
const TOKEN = 'reset-token-cru-0123456789abcdef'
const TOKEN_PRIMEIRO_ACESSO = 'primeiro-acesso-token-cru-0123456789'
const SENHA = 'NovaSenha1#'
const daqui = (ms: number) => new Date(Date.now() + ms)

const donoDoToken = { id: IDS.user, nome: 'João', emailPessoal: 'joao@example.com', emailEducacional: null, ativo: true, deletadoEm: null as Date | null }
let dono = donoDoToken
let rows: Linha[]

function novasLinhas(): Linha[] {
  return [
    { id: 't-reset', usuarioId: IDS.user, tokenHash: sha256(TOKEN), finalidade: 'RESET_SENHA', expiraEm: daqui(3_600_000), usadoEm: null },
    { id: 't-primeiro', usuarioId: IDS.user, tokenHash: sha256(TOKEN_PRIMEIRO_ACESSO), finalidade: 'PRIMEIRO_ACESSO', expiraEm: daqui(3_600_000), usadoEm: null },
  ]
}

function instalarRepositorio() {
  prismaMock.tokenResetSenha.findFirst.mockImplementation(async (args: any) => {
    const w = args.where
    const r = rows.find((x) => x.tokenHash === w.tokenHash && (w.finalidade === undefined || x.finalidade === w.finalidade))
    return r ? { ...r, usuario: dono } : null
  })
  prismaMock.tokenResetSenha.updateMany.mockImplementation(async (args: any) => {
    const w = args.where
    const alvos = rows.filter(
      (x) =>
        (w.id === undefined || x.id === w.id) &&
        (w.usuarioId === undefined || x.usuarioId === w.usuarioId) &&
        (w.finalidade === undefined || x.finalidade === w.finalidade) &&
        (w.usadoEm === undefined || x.usadoEm === w.usadoEm) &&
        (w.expiraEm?.gt === undefined || x.expiraEm > w.expiraEm.gt),
    )
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
  mockSend.mockResolvedValue(undefined)
  vi.mocked(passwordModule.hashPassword).mockReset()
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:nova')
  dono = { ...donoDoToken }
  rows = novasLinhas()
  instalarRepositorio()
  prismaMock.usuario.update.mockResolvedValue({ id: IDS.user })
  prismaMock.sessao.updateMany.mockResolvedValue({ count: 2 })
  prismaMock.tokenResetSenha.create.mockResolvedValue({})
})

describe('POST /password-resets', () => {
  const pedir = (payload?: unknown) => app.inject({ method: 'POST', url: '/password-resets', payload: payload as never })
  const contaExiste = () =>
    prismaMock.usuario.findFirst.mockResolvedValue({ id: IDS.user, nome: 'João', emailPessoal: 'joao@example.com', emailEducacional: null })

  it('202 — corpo com mensagem e link para o login, sem self (rota pública, sem Authorization)', async () => {
    contaExiste()

    const res = await pedir({ email: 'joao@example.com' })

    expect(res.statusCode).toBe(202)
    const body = res.json<{ message: string; _links: Record<string, { href: string; method: string }> }>()
    expect(body.message).toEqual(expect.any(String))
    expect(body._links).toEqual({ login: { href: '/sessions', method: 'POST' } })
    expect(body._links).not.toHaveProperty('self')
  })

  it('conta existente e conta inexistente: MESMO status e MESMO corpo (não revela cadastro)', async () => {
    contaExiste()
    const existente = await pedir({ email: 'joao@example.com' })
    prismaMock.usuario.findFirst.mockResolvedValue(null)
    const inexistente = await pedir({ email: 'ninguem@example.com' })

    expect(inexistente.statusCode).toBe(existente.statusCode)
    expect(inexistente.json()).toEqual(existente.json())
  })

  it('conta existente: grava token RESET_SENHA válido por 1 h e envia o link com esse token', async () => {
    contaExiste()

    await pedir({ email: 'Joao@Example.com ' })

    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    const data = (prismaMock.tokenResetSenha.create.mock.calls[0][0] as any).data
    expect(data.finalidade).toBe('RESET_SENHA')
    expect(data.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000)
    const enviado = JSON.stringify(mockSend.mock.calls[0][0])
    expect(enviado).toContain('joao@example.com')
    const tokenNoEmail = /token=([0-9a-f]{64})/.exec(enviado)?.[1]
    expect(tokenNoEmail).toBeDefined()
    expect(sha256(tokenNoEmail ?? '')).toBe(data.tokenHash)
  })

  it('conta inexistente: não cria token e não envia e-mail', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue(null)

    const res = await pedir({ email: 'ninguem@example.com' })

    expect(res.statusCode).toBe(202)
    expect(prismaMock.tokenResetSenha.create).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('falha no envio do e-mail: continua 202', async () => {
    contaExiste()
    mockSend.mockRejectedValue(new Error('SES indisponível'))

    const res = await pedir({ email: 'joao@example.com' })

    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalled())
  })

  it('responde SEM esperar o envio do e-mail (senão o tempo revelaria que a conta existe)', async () => {
    contaExiste()
    mockSend.mockImplementation(() => new Promise<void>(() => {})) // o envio nunca termina

    const res = await Promise.race([
      pedir({ email: 'joao@example.com' }),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('o POST esperou o envio do e-mail')), 1500)),
    ])

    expect(res.statusCode).toBe(202)
  })

  it('falha do banco: continua 202 e não vaza a falha', async () => {
    prismaMock.usuario.findFirst.mockRejectedValue(new Error('db fora'))

    const res = await pedir({ email: 'joao@example.com' })

    expect(res.statusCode).toBe(202)
    expect(res.body).not.toContain('db fora')
  })

  it.each([
    ['sem corpo', undefined],
    ['sem e-mail', {}],
    ['e-mail inválido', { email: 'isto-nao-e-email' }],
    ['e-mail não string', { email: 123 }],
  ])('400 — %s', async (_nome, payload) => {
    const res = await pedir(payload)

    const body = expectProblem(res, 400)
    expect(body.errors?.length).toBeGreaterThan(0)
    expect(prismaMock.usuario.findFirst).not.toHaveBeenCalled()
  })
})

describe('PUT /password-resets/:token', () => {
  const redefinir = (token: string, payload: unknown = { novaSenha: SENHA }, headers: Record<string, string> = {}) =>
    app.inject({ method: 'PUT', url: `/password-resets/${token}`, payload: payload as never, headers })

  function nadaMudou() {
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
    expect(passwordModule.hashPassword).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  }

  it('204 — sem corpo, sem sessão nova, consome o token, troca a senha e encerra TODAS as sessões', async () => {
    const res = await redefinir(TOKEN)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(passwordModule.hashPassword).toHaveBeenCalledWith(SENHA)
    expect(rows.find((r) => r.id === 't-reset')?.usadoEm).toBeInstanceOf(Date)
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: IDS.user },
      data: { senhaHash: 'hashed:nova', precisaTrocarSenha: false, passwordUpdatedAt: expect.any(Date) },
    })
    expect(prismaMock.sessao.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: IDS.user, revogadaEm: null },
      data: { revogadaEm: expect.any(Date) },
    })
    expect(prismaMock.sessao.create).not.toHaveBeenCalled()
  })

  it('204 — registra a auditoria reset_senha_sucesso', async () => {
    await redefinir(TOKEN)

    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: { feitoPorId: IDS.user, acao: 'reset_senha_sucesso', alvo: IDS.user, meta: {} },
    })
  })

  it('204 — avisa o dono por e-mail, sem senha nem token no conteúdo', async () => {
    await redefinir(TOKEN)

    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    const aviso = mockSend.mock.calls[0][0]
    expect(aviso.to).toBe('joao@example.com')
    const conteudo = JSON.stringify(aviso)
    for (const segredo of [SENHA, 'hashed:nova', TOKEN]) expect(conteudo).not.toContain(segredo)
  })

  it('204 — falha no envio do aviso NÃO desfaz a redefinição', async () => {
    mockSend.mockRejectedValue(new Error('SES indisponível'))

    const res = await redefinir(TOKEN)

    expect(res.statusCode).toBe(204)
    expect(prismaMock.usuario.update).toHaveBeenCalledTimes(1)
  })

  it('é público: funciona sem Authorization e ignora um Bearer inválido', async () => {
    const res = await redefinir(TOKEN, { novaSenha: SENHA }, { authorization: 'Bearer lixo' })

    expect(res.statusCode).toBe(204)
  })

  it('INVALIDA os outros tokens de reset pendentes do usuário (e só eles)', async () => {
    rows.push(
      { id: 't-reset-2', usuarioId: IDS.user, tokenHash: sha256('segundo-pedido-0123456789'), finalidade: 'RESET_SENHA', expiraEm: daqui(3_600_000), usadoEm: null },
      { id: 't-reset-alheio', usuarioId: 'user-id-999', tokenHash: sha256('de-outro-usuario-0123456789'), finalidade: 'RESET_SENHA', expiraEm: daqui(3_600_000), usadoEm: null },
    )

    expect((await redefinir(TOKEN)).statusCode).toBe(204)

    const usado = (id: string) => rows.find((r) => r.id === id)?.usadoEm
    expect(usado('t-reset')).toBeInstanceOf(Date)
    expect(usado('t-reset-2')).toBeInstanceOf(Date) // o segundo link do mesmo usuário morre junto
    expect(usado('t-reset-alheio')).toBeNull() // outro usuário, intacto
    expect(usado('t-primeiro')).toBeNull() // outra finalidade, intacto
    // e o segundo link, de fato, deixou de valer
    expectProblem(await redefinir('segundo-pedido-0123456789', { novaSenha: 'OutraSenha2$' }), 409)
  })

  it('REPLAY: o mesmo token usado de novo dá 409 e a senha NÃO é trocada outra vez', async () => {
    expect((await redefinir(TOKEN)).statusCode).toBe(204)
    prismaMock.usuario.update.mockClear()

    const segunda = await redefinir(TOKEN, { novaSenha: 'OutraSenha2$' })

    const body = expectProblem(segunda, 409)
    expect(body.title).toBe('Token já utilizado')
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('CORRIDA: se o token foi consumido entre a leitura e a gravação, 409 e nada é alterado', async () => {
    prismaMock.tokenResetSenha.updateMany.mockResolvedValue({ count: 0 })

    const res = await redefinir(TOKEN)

    expectProblem(res, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('CORRIDA REAL: leitura desatualizada (outra requisição consome o token logo após a leitura) dá 409 e nada muda', async () => {
    const leituraOriginal = prismaMock.tokenResetSenha.findFirst.getMockImplementation()!
    prismaMock.tokenResetSenha.findFirst.mockImplementation(async (args: any) => {
      const lida = await leituraOriginal(args) // snapshot ainda com usadoEm: null
      rows[0].usadoEm = new Date() // a outra requisição consome o token depois da leitura
      return lida
    })

    const res = await redefinir(TOKEN)

    expectProblem(res, 409)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('409 — token já usado (e ainda dentro da validade)', async () => {
    rows[0].usadoEm = new Date(Date.now() - 60_000)

    const res = await redefinir(TOKEN)

    expectProblem(res, 409)
    nadaMudou()
  })

  describe('404 — token que "não existe" para este fluxo', () => {
    it('token inexistente', async () => {
      const body = expectProblem(await redefinir('nao-existe-0123456789'), 404)
      expect(body.title).toBe('Token inválido ou expirado')
      nadaMudou()
    })

    it('token expirado', async () => {
      rows[0].expiraEm = new Date(Date.now() - 1000)
      expectProblem(await redefinir(TOKEN), 404)
      nadaMudou()
    })

    it('token de PRIMEIRO_ACESSO não vale como reset (S19)', async () => {
      expectProblem(await redefinir(TOKEN_PRIMEIRO_ACESSO), 404)
      nadaMudou()
    })

    it('conta inativa', async () => {
      dono.ativo = false
      expectProblem(await redefinir(TOKEN), 404)
      nadaMudou()
    })

    it('conta apagada (soft delete)', async () => {
      dono.deletadoEm = new Date()
      expectProblem(await redefinir(TOKEN), 404)
      nadaMudou()
    })
  })

  it.each([
    ['curta', 'Ab1#xyz'],
    ['sem maiúscula', 'novasenha1#'],
    ['sem símbolo', 'NovaSenha12'],
    ['só espaços', '        '],
  ])('400 — senha %s: erro no campo novaSenha e o banco nem é consultado', async (_nome, senha) => {
    const res = await redefinir(TOKEN, { novaSenha: senha })

    const body = expectProblem(res, 400)
    expect(body.errors?.some((e) => e.field === 'novaSenha')).toBe(true)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
    nadaMudou()
  })

  it('apara espaços nas pontas: o hash é do valor APARADO (o mesmo que o login vai usar)', async () => {
    const res = await redefinir(TOKEN, { novaSenha: `  ${SENHA}  ` })

    expect(res.statusCode).toBe(204)
    expect(passwordModule.hashPassword).toHaveBeenCalledWith(SENHA)
  })

  it('400 — sem corpo', async () => {
    const res = await app.inject({ method: 'PUT', url: `/password-resets/${TOKEN}` })

    expectProblem(res, 400)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('400 — campo antigo newPassword (o contrato agora é novaSenha)', async () => {
    const res = await redefinir(TOKEN, { newPassword: SENHA })

    expectProblem(res, 400)
    expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
  })

  it('500 — falha inesperada do banco não vaza a mensagem', async () => {
    prismaMock.tokenResetSenha.findFirst.mockRejectedValue(new Error('segredo-interno'))

    const res = await redefinir(TOKEN)

    expectProblem(res, 500)
    expect(res.body).not.toContain('segredo-interno')
  })
})
