/**
 * Reset de senha por token deve revogar as sessões existentes
 * (consistente com POST /auth/trocar-senha), impedindo que um refresh
 * anterior continue válido após a redefinição.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:nova'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))
// Evita import de driver de e-mail ao carregar o service.
vi.mock('../../src/config/mail', () => ({ getMailDriver: () => ({ send: vi.fn() }) }))

import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { consumirTokenSenha } from '../../src/core/auth/reset-senha.service'
import { resetMocks } from '../helpers/reset'

beforeEach(() => {
  resetMocks()
})

describe('consumirTokenSenha', () => {
  it('revoga as sessões ativas do usuário na mesma transação', async () => {
    prismaMock.tokenResetSenha.findFirst.mockResolvedValue({ id: 'tok-1', usuarioId: 'user-9', usadoEm: null })
    prismaMock.$transaction.mockResolvedValue([])
    prismaMock.usuario.findUnique.mockResolvedValue({ id: 'user-9', nome: 'X', ra: null, papel: 'USUARIO' })
    prismaMock.sessao.updateMany.mockReturnValue('op-revoga' as any)

    await consumirTokenSenha(prismaMock as any, 'token-cru', 'NovaSenha1#')

    // A revogação de sessões deve ser montada por usuarioId e entrar na transação.
    expect(prismaMock.sessao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usuarioId: 'user-9', revogadaEm: null }) }),
    )
    const txArg = prismaMock.$transaction.mock.calls[0][0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toContain('op-revoga')
  })
})
