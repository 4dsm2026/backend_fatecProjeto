import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inject } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createConnection, type Socket } from 'node:net'

let current: Promise<{ baseUrl: string; storageDir: string; close: () => Promise<void> }> | undefined
let closed = false

/** Uma promessa compartilhada evita duas APIs concorrentes no mesmo ambiente de testes. */
export function createTestApp() {
  if (closed) return Promise.reject(new Error('A API do worker já foi encerrada'))
  if (current) return current
  current = (async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'workflow-integration-'))
    let app: FastifyInstance | undefined
    let socket: Socket | undefined
    try {
      Object.assign(process.env, {
        NODE_ENV: 'test', DATABASE_URL: inject('integrationDatabaseUrl'),
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
        COOKIE_SECRET: randomBytes(32).toString('hex'),
        DEFAULT_TEMP_PASSWORD: `Test-${randomBytes(24).toString('hex')}aA1!`,
        STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: storageDir,
        MAIL_DRIVER: 'resend', RESEND_API_KEY: 'test-only',
        RESEND_BASE_URL: 'http://127.0.0.1:9',
      })
      const { buildApp } = await import('../../../src/app')
      app = await buildApp()
      const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
      let closing: Promise<void> | undefined
      const result = {
        baseUrl, storageDir,
        close: () => {
          closed = true
          closing ??= (async () => {
            const errors: unknown[] = []
            try { await app?.close() } catch (error) { errors.push(error) }
            try { await rm(storageDir, { recursive: true, force: true }) } catch (error) { errors.push(error) }
            if (errors.length) throw new AggregateError(errors, 'Falha ao encerrar a API de teste')
          })()
          return closing
        },
      }
      socket = createConnection({ host: '127.0.0.1', port: inject('lifecyclePort') })
      const lifecycleSocket = socket
      await new Promise<void>((resolve, reject) => {
        let pending = ''
        lifecycleSocket.setTimeout(30_000, () => lifecycleSocket.destroy(new Error('Timeout no lifecycle')))
        lifecycleSocket.once('error', reject)
        const onClose = () => reject(new Error('Lifecycle desconectou antes da confirmação'))
        lifecycleSocket.once('close', onClose)
        lifecycleSocket.once('connect', () => lifecycleSocket.write(inject('lifecycleToken') + '\n'))
        const receive = (data: Buffer) => {
          pending += data.toString()
          if (pending.length > 256) { lifecycleSocket.destroy(); reject(new Error('Resposta de lifecycle inválida')); return }
          const end = pending.indexOf('\n')
          if (end < 0) return
          lifecycleSocket.off('data', receive)
          lifecycleSocket.off('close', onClose)
          lifecycleSocket.setTimeout(0)
          pending.slice(0, end) === 'ready' ? resolve() : reject(new Error('Lifecycle recusado'))
        }
        lifecycleSocket.on('data', receive)
      })
      let command = ''
      lifecycleSocket.on('data', async data => {
        command += data.toString()
        if (command.length > 256) { lifecycleSocket.destroy(); return }
        if (!command.includes('\n')) return
        if (command.trim() !== 'close') { lifecycleSocket.destroy(); return }
        try { await result.close(); lifecycleSocket.write('closed\n') }
        catch { lifecycleSocket.write('error\n') }
      })
      return result
    } catch (error) {
      socket?.destroy()
      const errors: unknown[] = [error]
      try { await app?.close() } catch (cleanupError) { errors.push(cleanupError) }
      try { await rm(storageDir, { recursive: true, force: true }) } catch (cleanupError) { errors.push(cleanupError) }
      if (errors.length > 1) throw new AggregateError(errors, 'Falha ao iniciar e encerrar a API de teste')
      throw error
    }
  })()
  return current
}
