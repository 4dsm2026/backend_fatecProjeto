import { describe, it, expect } from 'vitest'
import { GenericContainer } from 'testcontainers'

describe('Docker básico', () => {
  it('sobe um container genérico simples (sem MySQL)', async () => {
    const container = await new GenericContainer('hello-world')
      .withStartupTimeout(30_000)
      .start()

    expect(container).toBeDefined()
    await container.stop()
  }, 40_000)
})