import { createServer } from 'node:net'
import type { TestProject } from 'vitest/node'
import setupDatabase from '../_setup/globalSetup'

// Exercita uma desconexão real do canal após a API ter iniciado.
export default async function setup(project: TestProject) {
  const teardownDatabase = await setupDatabase(project)
  const server = createServer(socket => socket.once('data', () => socket.end()))
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível')
    project.provide('lifecyclePort', address.port)
  } catch (error) {
    await teardownDatabase()
    throw error
  }
  return async () => {
    try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    finally { await teardownDatabase() }
  }
}
