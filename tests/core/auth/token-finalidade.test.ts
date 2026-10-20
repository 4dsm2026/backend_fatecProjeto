/**
 * S19: um token só vale no fluxo para o qual foi emitido.
 *
 * Em vez de só conferir a forma das chamadas ao Prisma, o `findFirst` abaixo
 * APLICA o `where` sobre linhas de verdade. Assim um consumidor que esqueça de
 * filtrar por `finalidade` aceita o token errado e o teste reprova.
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
import { consumirTokenSenha, enviarLinkEsqueciSenha, enviarLinkPrimeiroAcesso } from '../../../src/core/auth/reset-senha.service'
import * as passwordModule from '../../../src/security/password'
import { IDS } from '../../helpers/factories'
import { resetMocks } from '../../helpers/reset'

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
const TOKEN_RESET = 'reset-token-cru-0123456789'
const TOKEN_PRIMEIRO_ACESSO = 'primeiro-acesso-token-cru-0123456789'
const SENHA_NOVA = 'NovaSenha1#'

const usuario = {
  id: IDS.user,
  nome: 'João',
  ra: null,
  papel: 'USUARIO',
  ativo: true,
  emailPessoal: 'joao@example.com',
}

function linhas(): Linha[] {
  const daqui1h = new Date(Date.now() + 3_600_000)
  return [
    { id: 't-reset', usuarioId: IDS.user, tokenHash: sha256(TOKEN_RESET), finalidade: 'RESET_SENHA', expiraEm: daqui1h, usadoEm: null },
    { id: 't-primeiro', usuarioId: IDS.user, tokenHash: sha256(TOKEN_PRIMEIRO_ACESSO), finalidade: 'PRIMEIRO_ACESSO', expiraEm: daqui1h, usadoEm: null },
  ]
}

/** findFirst que aplica o where (tokenHash, finalidade, usadoEm, expiraEm) sobre as linhas. */
function instalarRepositorioDeTokens(rows: Linha[]) {
  prismaMock.tokenResetSenha.findFirst.mockImplementation(async (args: any) => {
    const w = args.where
    const achada = rows.find(
      (r) =>
        r.tokenHash === w.tokenHash &&
        (w.finalidade === undefined || r.finalidade === w.finalidade) &&
        (w.usadoEm === undefined || r.usadoEm === w.usadoEm) &&
        (w.expiraEm?.gt === undefined || r.expiraEm > w.expiraEm.gt),
    )
    if (!achada) return null
    return args.include?.usuario ? { ...achada, usuario } : achada
  })
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
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:nova')
  instalarRepositorioDeTokens(linhas())
  prismaMock.sessao.create.mockResolvedValue({ id: 'session-001' })
  prismaMock.usuario.findUnique.mockResolvedValue(usuario)
  prismaMock.usuario.update.mockResolvedValue({ id: IDS.user, nome: 'João', papel: 'USUARIO', emailPessoal: 'joao@example.com' })
  prismaMock.tokenResetSenha.update.mockResolvedValue({})
  prismaMock.sessao.updateMany.mockResolvedValue({ count: 0 })
})

describe('consumidor do reset (consumirTokenSenha)', () => {
  it('aceita um token de RESET_SENHA', async () => {
    await expect(consumirTokenSenha(prismaMock as any, TOKEN_RESET, SENHA_NOVA)).resolves.toMatchObject({ id: IDS.user })
    expect(prismaMock.tokenResetSenha.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-reset' } }))
  })

  it('REJEITA um token de PRIMEIRO_ACESSO como se não existisse (400), sem trocar senha nem revogar sessão', async () => {
    await expect(consumirTokenSenha(prismaMock as any, TOKEN_PRIMEIRO_ACESSO, SENHA_NOVA)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Token inválido ou expirado.',
    })
    expect(passwordModule.hashPassword).not.toHaveBeenCalled()
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.updateMany).not.toHaveBeenCalled()
  })
})

describe('consumidor do primeiro acesso (POST /auth/primeiro-acesso)', () => {
  const chamar = (token: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/auth/primeiro-acesso', payload: { token, newPassword: SENHA_NOVA, ...extra } })

  it('aceita um token de PRIMEIRO_ACESSO', async () => {
    const res = await chamar(TOKEN_PRIMEIRO_ACESSO)

    expect(res.statusCode).toBe(200)
    expect(prismaMock.tokenResetSenha.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-primeiro' } }))
  })

  it('REJEITA um token de RESET_SENHA (400): não troca senha NEM o e-mail da conta', async () => {
    const res = await chamar(TOKEN_RESET, { personalEmail: 'outro@example.com' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('error', 'Token inválido ou expirado.')
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
    expect(prismaMock.tokenResetSenha.update).not.toHaveBeenCalled()
    expect(prismaMock.sessao.create).not.toHaveBeenCalled()
  })
})

describe('criadores gravam a finalidade certa', () => {
  const dadosDoCreate = () => (prismaMock.tokenResetSenha.create.mock.calls[0][0] as any).data

  it('esqueci a senha: RESET_SENHA, válido por 1 h', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue({ id: IDS.user, nome: 'João', emailPessoal: 'joao@example.com', emailEducacional: null })
    prismaMock.tokenResetSenha.create.mockResolvedValue({})

    await enviarLinkEsqueciSenha(prismaMock as any, 'joao@example.com')

    const data = dadosDoCreate()
    expect(data.finalidade).toBe('RESET_SENHA')
    expect(data.expiraEm.getTime() - Date.now()).toBeGreaterThan(55 * 60_000)
    expect(data.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000)
  })

  it('link de primeiro acesso: PRIMEIRO_ACESSO, válido por 24 h', async () => {
    prismaMock.tokenResetSenha.create.mockResolvedValue({})

    await enviarLinkPrimeiroAcesso(prismaMock as any, { id: IDS.user, nome: 'João', emailPessoal: 'joao@example.com', emailEducacional: null })

    const data = dadosDoCreate()
    expect(data.finalidade).toBe('PRIMEIRO_ACESSO')
    expect(data.expiraEm.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000)
    expect(data.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000)
  })
})
