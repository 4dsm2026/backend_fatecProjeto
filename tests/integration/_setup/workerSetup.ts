import { beforeAll, beforeEach } from 'vitest'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestApp } from './createTestApp'

beforeAll(async () => {
  const { baseUrl } = await createTestApp()
  process.env.WORKFLOW_INTEGRATION_FIRST_URL ??= baseUrl
  if (process.env.WORKFLOW_INTEGRATION_FIRST_URL !== baseUrl) throw new Error('Worker criou outra API')
})
// Esta configuração é serial e limitada aos smokes sem efeitos em segundo plano.
beforeEach(async () => {
  const { resetDatabase } = await import('./resetDatabase')
  await resetDatabase()
  const { storageDir } = await createTestApp()
  for (const entry of await readdir(storageDir)) {
    await rm(join(storageDir, entry), { recursive: true, force: true })
  }
})
