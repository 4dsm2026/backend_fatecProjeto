import type { TestProject } from 'vitest/node'
import { startMigratedMySql } from '../containers/mysql'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { createServer, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

declare module 'vitest' {
  export interface ProvidedContext {
    integrationDatabaseUrl: string
    integrationToken: string
    integrationMailboxUrl: string
    lifecyclePort: number
    lifecycleToken: string
  }
}

/** Uma instância por execução; a URL é entregue aos workers somente após as migrations. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await startMigratedMySql(process.env.TEST_MYSQL_IMAGE || 'mysql:8.0.39')
  let mailbox: StartedTestContainer
  try {
    const source = await readFile(resolve('tests/integration/containers/fake-mail/server.mjs'), 'utf8')
    mailbox = await new GenericContainer('node:22-alpine')
      .withCopyContentToContainer([{ content: source, target: '/server.mjs' }])
      .withCommand(['node', '/server.mjs'])
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp('/health', 3000))
      .start()
  } catch (error) {
    await container.stop()
    throw error
  }
  const peers = new Set<Socket>()
  const sockets = new Set<Socket>()
  let shuttingDown = false
  let lostPeer = false
  const lifecycleToken = randomBytes(32).toString('hex')
  const server = createServer(socket => {
    let message = ''
    sockets.add(socket)
    socket.setTimeout(30_000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      sockets.delete(socket)
      if (peers.delete(socket) && !shuttingDown) lostPeer = true
    })
    socket.on('data', data => {
      message += data.toString()
      if (message.length > 256) { socket.destroy(); return }
      if (!message.includes('\n')) return
      if (message.trim() !== lifecycleToken || peers.size !== 0) { socket.destroy(); return }
      socket.removeAllListeners('data')
      socket.setTimeout(0)
      peers.add(socket)
      socket.write('ready\n')
    })
  })
  try {
    const url = container.getConnectionUri()
    const token = randomBytes(32).toString('hex')
    const prisma = new PrismaClient({ datasources: { db: { url } } })
    try {
      await prisma.$executeRawUnsafe('CREATE TABLE _integration_owner (token VARCHAR(64) NOT NULL)')
      await prisma.$executeRaw`INSERT INTO _integration_owner (token) VALUES (${token})`
    } finally {
      await prisma.$disconnect()
    }
    project.provide('integrationDatabaseUrl', url)
    project.provide('integrationToken', token)
    project.provide('integrationMailboxUrl', `http://${mailbox.getHost()}:${mailbox.getMappedPort(3000)}`)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Lifecycle indisponível')
    project.provide('lifecyclePort', address.port)
    project.provide('lifecycleToken', lifecycleToken)
  } catch (error) {
    server.close()
    await mailbox.stop()
    await container.stop()
    throw error
  }
  return async () => {
    shuttingDown = true
    const errors: unknown[] = []
    try {
      const activePeers = [...peers]
      if (lostPeer) throw new Error('Worker desconectou antes do teardown global')
      await Promise.all(activePeers.map(peer => new Promise<void>((resolve, reject) => {
        let done = false
        const timer = setTimeout(() => finish(new Error('Timeout no fechamento do worker')), 30000)
        const finish = (error?: Error) => {
          if (done) return
          done = true
          clearTimeout(timer)
          peer.destroy()
          if (error) reject(error)
          else resolve()
        }
        let response = ''
        peer.on('data', data => {
          response += data.toString()
          if (response.length > 256) return finish(new Error('Resposta de lifecycle inválida'))
          if (response.includes('\n')) {
            if (response.trim() === 'closed') finish()
            else finish(new Error('Falha no fechamento da API'))
          }
        })
        peer.once('error', finish)
        peer.once('close', () => finish(new Error('Worker desconectou antes do fechamento')))
        peer.write('close\n')
      })))
      if (activePeers.length) console.info('Lifecycle: fechamento do worker confirmado')
    } catch (error) {
      errors.push(error)
    } finally {
      for (const socket of sockets) socket.destroy()
      try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
      catch (error) { errors.push(error) }
      try { await container.stop() } catch (error) { errors.push(error) }
      try { await mailbox.stop() } catch (error) { errors.push(error) }
    }
    if (errors.length) {
      // Vitest 2 encerra o pool depois do teardown. Não lançar aqui permite que ele
      // ainda feche o pool; o processo deve sinalizar que a limpeza falhou.
      console.error('Falha no teardown de integração:', new AggregateError(errors))
      process.exitCode = 1
    }
  }
}
