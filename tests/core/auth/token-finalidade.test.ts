/**
 * S19: os criadores de token gravam a finalidade e a validade certas.
 *
 * O CONSUMO (um token só vale no fluxo para o qual foi emitido) é testado nos
 * endpoints, com um repositório que aplica o `where` sobre linhas de verdade:
 * tests/core/sessions/password-resets.test.ts e account-activations.test.ts.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../../src/lib/prisma')
const mockSend = vi.fn()
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))

import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { enviarLinkEsqueciSenha, enviarLinkPrimeiroAcesso } from '../../../src/core/auth/reset-senha.service'
import { IDS } from '../../helpers/factories'
import { resetMocks } from '../../helpers/reset'

beforeEach(() => {
  resetMocks()
  mockSend.mockReset()
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
