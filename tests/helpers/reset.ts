/**
 * vi.clearAllMocks() only clears call history, NOT queued mockResolvedValueOnce values.
 * vi.resetAllMocks() clears both — use this in beforeEach for test isolation.
 * After reset, restore critical Prisma mock implementations.
 */
import { vi } from 'vitest'
import { prismaMock } from '../../src/lib/__mocks__/prisma'

export function resetMocks() {
  vi.resetAllMocks()

  // Restore: $connect / $queryRaw / $transaction are used by the app on every request
  prismaMock.$connect.mockResolvedValue(undefined)
  prismaMock.$queryRaw.mockResolvedValue([{ 1: 1 }])
  prismaMock.$transaction.mockImplementation((fnOrArr: any) =>
    typeof fnOrArr === 'function' ? fnOrArr(prismaMock) : Promise.all(fnOrArr),
  )

  // Restore common side-effect mocks that most handlers call
  prismaMock.auditoria.create.mockResolvedValue({})
}
