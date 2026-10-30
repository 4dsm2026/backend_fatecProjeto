/**
 * Segurança: o WebSocket não repassa frames de clientes.
 *
 * Antes, qualquer cliente autenticado podia mandar { type: "nova_mensagem", ... }
 * e o servidor entregava a todos os conectados, o que permitia forjar uma mensagem
 * de outra pessoa. A mensagem real nasce só no POST /tickets/:id/messages e é
 * emitida pelo servidor (broadcastWS).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { buildApp } from '../../src/app'
import { appGlobals } from '../../src/types/app-globals'
import { makeUserToken } from '../helpers/auth'

let app: FastifyInstance
let wsUrl: string
const sockets: WebSocket[] = []

/** Guarda tudo que o socket receber, para o teste poder olhar depois. */
function collect(ws: WebSocket): unknown[] {
  const received: unknown[] = []
  ws.on('message', (raw) => received.push(JSON.parse(raw.toString())))
  return received
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Abre uma conexão de verdade no servidor de teste (o injectWS não tem socket e quebra o log). */
async function open(): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl)
  sockets.push(ws)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return ws
}

async function connectAs(sub: string) {
  const ws = await open()
  const received = collect(ws)
  ws.send(JSON.stringify({ type: 'auth', token: makeUserToken({ sub }) }))
  await vi.waitFor(() => expect(received).toContainEqual({ type: 'auth_ok' }))
  return { ws, received }
}

beforeAll(async () => {
  app = await buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as { port: number }
  wsUrl = `ws://127.0.0.1:${port}/ws`
})

afterAll(async () => {
  for (const ws of sockets) ws.terminate()
  await app.close()
})

describe('WebSocket /ws — sem relay entre clientes', () => {
  it('um cliente autenticado não consegue forjar nova_mensagem para os outros', async () => {
    const atacante = await connectAs('user-atacante')
    const vitima = await connectAs('user-vitima')

    atacante.ws.send(
      JSON.stringify({
        type: 'nova_mensagem',
        chamadoId: 'chamado-1',
        mensagem: 'mensagem forjada',
        autorId: 'user-vitima',
        autor: { nome: 'Outra Pessoa' },
      }),
    )
    await wait(300)

    const forjadas = vitima.received.filter(
      (f) => (f as { type?: string }).type === 'nova_mensagem',
    )
    expect(forjadas).toHaveLength(0)
  })

  it('controle: o broadcast legítimo do servidor continua chegando aos conectados', async () => {
    const cliente = await connectAs('user-legitimo')

    appGlobals().broadcastWS?.({ type: 'nova_mensagem', chamadoId: 'chamado-1', mensagem: { id: 'm1' } })

    await vi.waitFor(() =>
      expect(cliente.received).toContainEqual({
        type: 'nova_mensagem',
        chamadoId: 'chamado-1',
        mensagem: { id: 'm1' },
      }),
    )
  })

  it('frame sem autenticação é recusado e a conexão fecha', async () => {
    const ws = await open()
    const received = collect(ws)
    const fechou = new Promise<void>((resolve) => ws.on('close', () => resolve()))

    ws.send(JSON.stringify({ type: 'nova_mensagem', chamadoId: 'x', mensagem: 'oi' }))
    await fechou

    expect(received).toContainEqual({ error: 'Não autenticado' })
  })
})
