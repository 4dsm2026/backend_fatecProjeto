import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createTestApp } from '../_setup/createTestApp'

describe('MySQL descartável com migrations', () => {
  let prisma: PrismaClient | undefined

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('aplica as migrations e permite consultar uma tabela da aplicação', async () => {
    expect((await createTestApp()).baseUrl).toBe(process.env.WORKFLOW_INTEGRATION_FIRST_URL)
    const migrations = await prisma!.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `
    expect(Number(migrations[0].count)).toBeGreaterThan(0)
    expect(await prisma!.setor.count()).toBe(0)
  })
})
