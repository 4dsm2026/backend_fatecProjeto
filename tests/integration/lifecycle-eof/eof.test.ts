import { access } from 'node:fs/promises'
import { Server } from 'node:net'
import { expect, inject, it } from 'vitest'
import { createTestApp } from '../_setup/createTestApp'

it('rejeita e remove o diretório quando o canal fecha antes de ready', async () => {
  const originalListen = Server.prototype.listen
  let port: number | undefined
  Server.prototype.listen = function (this: Server, ...args: Parameters<typeof originalListen>) {
    this.once('listening', () => {
      const address = this.address()
      if (address && typeof address !== 'string') port = address.port
    })
    return Reflect.apply(originalListen, this, args) as Server
  } as typeof originalListen
  try {
    await expect(createTestApp()).rejects.toThrow('Lifecycle desconectou antes da confirmação')
    const storageDir = process.env.LOCAL_STORAGE_DIR
    expect(storageDir).toContain('workflow-integration-')
    await expect(access(storageDir!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(port).toBeDefined()
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM information_schema.processlist
        WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)
      `
      // Apenas a conexão usada para esta inspeção deve permanecer.
      expect(Number(rows[0].n)).toBe(1)
    } finally { await prisma.$disconnect() }
  } finally { Server.prototype.listen = originalListen }
}, 10_000)
