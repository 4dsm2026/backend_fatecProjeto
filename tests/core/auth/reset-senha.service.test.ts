/**
 * consumirTokenSenha: valida a política (zStrongPassword) ANTES de tocar no
 * banco e hasheia exatamente o valor validado (aparado), pois o login também
 * apara a senha.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:nova'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: vi.fn() }) }))

import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { consumirTokenSenha } from '../../../src/core/auth/reset-senha.service'
import * as passwordModule from '../../../src/security/password'
import { resetMocks } from '../../helpers/reset'

beforeEach(() => {
  resetMocks()
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:nova')
})

describe('consumirTokenSenha — política de senha', () => {
  it.each(['curta1#', 'semmaiuscula1#', 'SEMMINUSCULA1#', 'SemNumero##', 'SemSimbolo12'])(
    'rejeita %s com statusCode 400, sem consultar o banco nem hashear',
    async (fraca) => {
      await expect(consumirTokenSenha(prismaMock as any, 'token-cru', fraca)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Senha não atende aos critérios mínimos.',
      })
      expect(prismaMock.tokenResetSenha.findFirst).not.toHaveBeenCalled()
      expect(passwordModule.hashPassword).not.toHaveBeenCalled()
    },
  )

  it('hasheia o valor APARADO (o mesmo que o login vai usar)', async () => {
    prismaMock.tokenResetSenha.findFirst.mockResolvedValue({ id: 'tok-1', usuarioId: 'user-9', usadoEm: null })
    prismaMock.$transaction.mockResolvedValue([])
    prismaMock.usuario.findUnique.mockResolvedValue({ id: 'user-9', nome: 'X', ra: null, papel: 'USUARIO' })

    await consumirTokenSenha(prismaMock as any, 'token-cru', '  NovaSenha1#  ')

    expect(passwordModule.hashPassword).toHaveBeenCalledWith('NovaSenha1#')
  })

  it('token inexistente/expirado/usado lança 400 "Token inválido ou expirado."', async () => {
    prismaMock.tokenResetSenha.findFirst.mockResolvedValue(null)

    await expect(consumirTokenSenha(prismaMock as any, 'token-cru', 'NovaSenha1#')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Token inválido ou expirado.',
    })
    expect(passwordModule.hashPassword).not.toHaveBeenCalled()
  })
})
