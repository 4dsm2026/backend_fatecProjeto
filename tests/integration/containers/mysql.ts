import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'

/** A imagem deve ser informada pelo executor e acordada com a equipe. */
export async function startMigratedMySql(image: string): Promise<StartedMySqlContainer> {
  if (!image) throw new Error('Informe a imagem MySQL para os testes de integração')

  const container = await new MySqlContainer(image)
    .withDatabase('workflow_integration')
    .withUsername('integration')
    .withUserPassword(randomBytes(24).toString('hex'))
    .withRootPassword(randomBytes(24).toString('hex'))
    .start()

  try {
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      encoding: 'utf8',
      timeout: 120_000,
      stdio: 'pipe',
    })
    return container
  } catch (error) {
    try {
      await container.stop()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Migration falhou e o container não pôde ser encerrado')
    }
    throw error
  }
}
