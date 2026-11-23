import { describe, expect, it } from 'vitest'
import { createTicket } from '../_helpers/tickets'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { ticketRequest } from '../tickets/fixtures'

describe('Integração: mensagens e leitura', () => {
  it('pagina mensagens, isola outra pessoa e marca apenas mensagens recebidas', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    for (const [session, content] of [[f.aluno, 'Mensagem do aluno'], [f.funcionario, 'Resposta da equipe']] as const) {
      const response = await ticketRequest(f.ctx, session, `/tickets/${ticket.id}/messages`, {
        method: 'POST', body: JSON.stringify({ conteudo: content }),
      })
      expect(response.status).toBe(201)
    }
    const path = `/tickets/${ticket.id}/messages`
    const first = await ticketRequest(f.ctx, f.aluno, `${path}?page=0&size=1&orderDir=asc`)
    expect(first.status).toBe(200)
    const body = await first.json() as { page: { totalElements: number }; _embedded: { messages: Array<{ conteudo: string }> }; _links: Record<string, { href: string }> }
    expect(body.page.totalElements).toBe(2)
    expect(body._embedded.messages).toHaveLength(1)
    expect(body._embedded.messages[0].conteudo).toBe('Mensagem do aluno')
    expect(body._links.next.href).toContain('page=1')
    const second = await ticketRequest(f.ctx, f.aluno, body._links.next.href)
    expect((await second.json())._embedded.messages[0].conteudo).toBe('Resposta da equipe')
    expect((await ticketRequest(f.ctx, f.outroAluno, path)).status).toBe(404)
    expect(body._links).toHaveProperty('mark-read')
    const marked = await ticketRequest(f.ctx, f.aluno, path, { method: 'PATCH', body: JSON.stringify({ lida: true }) })
    expect(marked.status).toBe(200)
    expect((await marked.json()).updatedCount).toBe(1)
    const again = await ticketRequest(f.ctx, f.aluno, path, { method: 'PATCH', body: JSON.stringify({ lida: true }) })
    expect((await again.json()).updatedCount).toBe(0)
  })
})
