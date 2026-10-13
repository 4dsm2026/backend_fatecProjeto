import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('../../src/lib/prisma')

import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { verifyAndGetSession } from '../../src/security/refresh'
import { resetMocks } from '../helpers/reset'

beforeEach(() => resetMocks())

describe('verifyAndGetSession', () => {
  it('busca pelo SHA-256 do token, só sessão não revogada e não expirada', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue(null)
    const antes = Date.now()

    await verifyAndGetSession('token-qualquer')

    const arg = prismaMock.sessao.findFirst.mock.calls[0][0] as any
    expect(arg.where.refreshHash).toBe(createHash('sha256').update('token-qualquer').digest('hex'))
    expect(arg.where.revogadaEm).toBeNull()
    expect(arg.where.expiraEm.gt).toBeInstanceOf(Date)
    expect(arg.where.expiraEm.gt.getTime()).toBeGreaterThanOrEqual(antes)
  })

  it('devolve a sessão encontrada', async () => {
    prismaMock.sessao.findFirst.mockResolvedValue({ id: 's-1' })
    await expect(verifyAndGetSession('t')).resolves.toEqual({ id: 's-1' })
  })
})
