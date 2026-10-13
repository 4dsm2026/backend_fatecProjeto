import { vi, describe, it, expect, beforeEach } from 'vitest'

const hashPassword = vi.fn()
const verifyPassword = vi.fn()
vi.mock('../../src/security/password', () => ({ hashPassword, verifyPassword }))

// O módulo guarda o hash falso em memória: recarrega a cada teste.
async function load() {
  vi.resetModules()
  return import('../../src/security/dummy-verify')
}

beforeEach(() => {
  hashPassword.mockReset().mockResolvedValue('dummy-hash')
  verifyPassword.mockReset().mockResolvedValue(false)
})

describe('verifyDummyPassword', () => {
  it('verifica a senha informada contra o hash falso', async () => {
    const { verifyDummyPassword } = await load()
    await verifyDummyPassword('Test@1234')
    expect(verifyPassword).toHaveBeenCalledWith('dummy-hash', 'Test@1234')
  })

  it('gera o hash falso UMA vez, mesmo com chamadas concorrentes', async () => {
    const { verifyDummyPassword } = await load()
    await Promise.all([verifyDummyPassword('a'), verifyDummyPassword('b'), verifyDummyPassword('c')])
    await verifyDummyPassword('d')
    expect(hashPassword).toHaveBeenCalledTimes(1)
    expect(verifyPassword).toHaveBeenCalledTimes(4)
  })

  it('o hash falso é aleatório (não é um valor fixo conhecido)', async () => {
    const a = await load()
    await a.verifyDummyPassword('x')
    const b = await load()
    await b.verifyDummyPassword('x')
    expect(hashPassword.mock.calls[0][0]).not.toBe(hashPassword.mock.calls[1][0])
  })

  it('não guarda falha: se gerar o hash falhar, a próxima chamada tenta de novo', async () => {
    const { verifyDummyPassword } = await load()
    hashPassword.mockRejectedValueOnce(new Error('sem memória'))

    await expect(verifyDummyPassword('x')).rejects.toThrow('sem memória')
    await expect(verifyDummyPassword('x')).resolves.toBeUndefined()
    expect(hashPassword).toHaveBeenCalledTimes(2)
  })
})
