import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createTestApp } from '../_setup/createTestApp'

it('fecha API repetidamente e remove armazenamento temporário', async () => {
  const { baseUrl, storageDir, close } = await createTestApp()
  await writeFile(join(storageDir, 'temporary.txt'), 'temporary')
  const firstClose = close()
  const concurrentClose = close()
  expect(concurrentClose).toBe(firstClose)
  await Promise.all([firstClose, concurrentClose])
  await close()
  await expect(access(storageDir)).rejects.toThrow()
  await expect(fetch(new URL('/health', baseUrl))).rejects.toThrow()
  await expect(createTestApp()).rejects.toThrow('já foi encerrada')
})
