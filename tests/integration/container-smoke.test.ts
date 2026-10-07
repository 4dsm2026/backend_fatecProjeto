import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql'

describe('Testcontainers - smoke test', () => {
  let container: StartedMySqlContainer

  beforeAll(async () => {
    container = await new MySqlContainer('mysql:8.0.39')
      .withDatabase('workflow_fatec_test')
      .withUsername('test')
      .withUserPassword('test')
      .withRootPassword('root')
      .start()
  }, 120_000)

  afterAll(async () => {
    await container?.stop()
  })

  it('sobe um container MySQL real e expõe uma connection string', () => {
    const url = container.getConnectionUri()
    console.log('Container MySQL rodando em:', url)

    expect(url).toContain('mysql://')
    expect(container.getPort()).toBeGreaterThan(0)
  })
})