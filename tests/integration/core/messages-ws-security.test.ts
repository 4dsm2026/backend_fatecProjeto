import { once } from 'node:events'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { createTicket } from '../_helpers/tickets'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { ticketRequest } from '../tickets/fixtures'

describe('Segurança do WebSocket de mensagens', () => {
  it('não entrega a conversa a aluno sem acesso ao chamado', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const socket = new WebSocket(new URL('/ws', f.ctx.baseUrl).toString().replace(/^http/, 'ws'))
    const ownerSocket = new WebSocket(new URL('/ws', f.ctx.baseUrl).toString().replace(/^http/, 'ws'))
    const staffSocket = new WebSocket(new URL('/ws', f.ctx.baseUrl).toString().replace(/^http/, 'ws'))
    try {
      await Promise.all([once(socket, 'open'), once(ownerSocket, 'open'), once(staffSocket, 'open')])
      const handshake = once(socket, 'message')
      const ownerHandshake = once(ownerSocket, 'message')
      const staffHandshake = once(staffSocket, 'message')
      socket.send(JSON.stringify({ type: 'auth', token: f.outroAluno.accessToken }))
      ownerSocket.send(JSON.stringify({ type: 'auth', token: f.aluno.accessToken }))
      staffSocket.send(JSON.stringify({ type: 'auth', token: f.funcionario.accessToken }))
      const [raw] = await handshake
      expect(JSON.parse(raw.toString())).toMatchObject({ type: 'auth_ok' })
      const [ownerRaw] = await ownerHandshake
      expect(JSON.parse(ownerRaw.toString())).toMatchObject({ type: 'auth_ok' })
      const [staffRaw] = await staffHandshake
      expect(JSON.parse(staffRaw.toString())).toMatchObject({ type: 'auth_ok' })
      const received: Array<{ type?: string; chamadoId?: string }> = []
      const ownerReceived: Array<{ type?: string; chamadoId?: string }> = []
      const staffReceived: Array<{ type?: string; chamadoId?: string }> = []
      socket.on('message', data => { received.push(JSON.parse(data.toString())) })
      ownerSocket.on('message', data => { ownerReceived.push(JSON.parse(data.toString())) })
      staffSocket.on('message', data => { staffReceived.push(JSON.parse(data.toString())) })
      const response = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}/messages`, {
        method: 'POST', body: JSON.stringify({ conteudo: 'Mensagem privada de integração' }),
      })
      expect(response.status).toBe(201)
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(ownerReceived.some(frame => frame.type === 'nova_mensagem' && frame.chamadoId === ticket.id)).toBe(true)
      expect(staffReceived.some(frame => frame.type === 'nova_mensagem' && frame.chamadoId === ticket.id)).toBe(true)
      expect(received.some(frame => frame.type === 'nova_mensagem' && frame.chamadoId === ticket.id)).toBe(false)
    } finally {
      socket.terminate()
      ownerSocket.terminate()
      staffSocket.terminate()
    }
  })
})
