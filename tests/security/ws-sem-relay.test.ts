/**
 * Segurança: o WebSocket não repassa frames de clientes.
 *
 * Antes, qualquer cliente autenticado podia mandar { type: "nova_mensagem", ... }
 * e o servidor entregava a todos os conectados, o que permitia forjar uma mensagem
 * de outra pessoa. A mensagem real nasce só no POST /tickets/:id/messages e é
 * emitida pelo servidor, só para quem pode ver o chamado (sendToTicketViewersWS).
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
import { makeAdminToken, makeUserToken } from '../helpers/auth'

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

async function connectAs(sub: string, papel: 'USUARIO' | 'ADMINISTRADOR' | 'BACKOFFICE' = 'USUARIO') {
  const ws = await open()
  const received = collect(ws)
  const token = papel === 'ADMINISTRADOR' ? makeAdminToken({ sub }) : makeUserToken({ sub, role: papel })
  ws.send(JSON.stringify({ type: 'auth', token }))
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

  it('controle: a mensagem legítima do servidor chega ao dono do chamado', async () => {
    const cliente = await connectAs('user-legitimo')

    appGlobals().sendToTicketViewersWS?.('user-legitimo', { type: 'nova_mensagem', chamadoId: 'chamado-1', mensagem: { id: 'm1' } })

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

/**
 * GHSA-mgm4-3jqg-fx5j: a mensagem de um chamado ia para todos os conectados,
 * inclusive alunos que não têm nada a ver com ele.
 */
describe('WebSocket /ws — entrega só para quem pode ver o chamado', () => {
  it('o dono e a equipe recebem; outro aluno não', async () => {
    const dono = await connectAs('aluno-dono')
    const outroAluno = await connectAs('aluno-curioso')
    const secretaria = await connectAs('sec-1', 'BACKOFFICE')
    const admin = await connectAs('adm-1', 'ADMINISTRADOR')

    const evento = { type: 'nova_mensagem', chamadoId: 'chamado-9', mensagem: { id: 'm9', conteudo: 'dado pessoal' } }
    appGlobals().sendToTicketViewersWS?.('aluno-dono', evento)

    await vi.waitFor(() => expect(dono.received).toContainEqual(evento))
    await vi.waitFor(() => expect(secretaria.received).toContainEqual(evento))
    await vi.waitFor(() => expect(admin.received).toContainEqual(evento))
    await wait(200)
    expect(outroAluno.received).not.toContainEqual(evento)
  })

  it('não existe mais envio para todos os conectados', () => {
    expect((appGlobals() as Record<string, unknown>).broadcastWS).toBeUndefined()
  })

  it('duas abas do mesmo aluno recebem; fechar uma não derruba a outra (#122)', async () => {
    const aba1 = await connectAs('aluno-duas-abas')
    const aba2 = await connectAs('aluno-duas-abas')

    const primeiro = { type: 'nova_mensagem', chamadoId: 'c-abas', mensagem: { id: 'a1' } }
    appGlobals().sendToTicketViewersWS?.('aluno-duas-abas', primeiro)
    await vi.waitFor(() => expect(aba1.received).toContainEqual(primeiro))
    await vi.waitFor(() => expect(aba2.received).toContainEqual(primeiro))

    const fechou = new Promise<void>((resolve) => aba1.ws.on('close', () => resolve()))
    aba1.ws.close()
    await fechou
    await wait(100)

    const segundo = { type: 'nova_mensagem', chamadoId: 'c-abas', mensagem: { id: 'a2' } }
    appGlobals().sendToTicketViewersWS?.('aluno-duas-abas', segundo)
    await vi.waitFor(() => expect(aba2.received).toContainEqual(segundo))
  })
})
