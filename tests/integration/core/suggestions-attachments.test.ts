import { describe, expect, it, vi } from 'vitest'
import { assignTicket, changeStatus, createTicket } from '../_helpers/tickets'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { ticketRequest } from '../tickets/fixtures'

const document = (text: string) => ({
  type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('Integração: sugestões e anexos', () => {
  it('cria e responde sugestão com documentos, respeitando posse e links', async () => {
    const f = await prepareTicketFixtures()
    const created = await ticketRequest(f.ctx, f.aluno, '/suggestions', {
      method: 'POST', body: JSON.stringify({ emailContato: 'contato@example.test', conteudo: 'Sugestão para a escola', documento: document('Sugestão para a escola') }),
    })
    expect(created.status).toBe(201)
    const suggestion = await created.json() as { id: string; documento: unknown; _links: Record<string, unknown> }
    expect(created.headers.get('location')).toBe(`/suggestions/${suggestion.id}`)
    expect(suggestion.documento).toEqual(document('Sugestão para a escola'))
    expect(suggestion._links).not.toHaveProperty('answer')
    const denied = await ticketRequest(f.ctx, f.outroAluno, `/suggestions/${suggestion.id}`)
    expect(denied.status).toBe(404)
    const response = await ticketRequest(f.ctx, f.admin, `/suggestions/${suggestion.id}`, {
      method: 'PATCH', body: JSON.stringify({ resposta: 'Resposta da equipe', respostaDocumento: document('Resposta da equipe') }),
    })
    expect(response.status).toBe(200)
    const answered = await response.json() as { status: string; respostaDocumento: unknown; _links: Record<string, unknown> }
    expect(answered.status).toBe('RESPONDIDO')
    expect(answered.respostaDocumento).toEqual(document('Resposta da equipe'))
    expect(answered._links).not.toHaveProperty('answer')
    const again = await ticketRequest(f.ctx, f.admin, `/suggestions/${suggestion.id}`, {
      method: 'PATCH', body: JSON.stringify({ resposta: 'Outra resposta' }),
    })
    expect(again.status).toBe(409)
  })

  it('J5: envia e baixa arquivo real e bloqueia upload em chamado resolvido', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    await assignTicket(f.ctx, f.funcionario, ticket.id, f.funcionario.userId)
    const form = new FormData()
    form.append('file', new Blob(['conteúdo de integração'], { type: 'text/plain' }), 'comprovante.txt')
    const uploaded = await fetch(new URL(`/tickets/${ticket.id}/attachments`, f.ctx.baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${f.funcionario.accessToken}` }, body: form,
    })
    expect(uploaded.status).toBe(201)
    const attachment = await uploaded.json() as { id: string; nomeArquivo: string; mimeType: string; tamanhoBytes: number; _links: { content: { href: string } } }
    expect(attachment.nomeArquivo).toBe('comprovante.txt')
    expect(attachment.mimeType).toBe('text/plain')
    expect(attachment.tamanhoBytes).toBe(Buffer.byteLength('conteúdo de integração'))
    expect(uploaded.headers.get('location')).toBe(`/attachments/${attachment.id}`)
    const content = await ticketRequest(f.ctx, f.aluno, attachment._links.content.href)
    expect(content.status).toBe(200)
    expect(content.headers.get('content-type')).toContain('text/plain')
    expect(content.headers.get('content-disposition')).toContain('comprovante.txt')
    expect(await content.text()).toBe('conteúdo de integração')
    const denied = await ticketRequest(f.ctx, f.outroAluno, attachment._links.content.href)
    // O contrato de download atual documenta 403 para anexo existente sem permissão.
    expect(denied.status).toBe(403)

    // O envio dispara notificação sem await: esperar por ela antes de limpar o banco.
    await vi.waitFor(async () => {
      const response = await ticketRequest(f.ctx, f.aluno, '/notifications?page=0&size=100')
      const body = await response.json() as { _embedded: { notifications: Array<{ anexoId: string | null }> } }
      expect(body._embedded.notifications.some((item) => item.anexoId === attachment.id)).toBe(true)
    }, { timeout: 10_000, interval: 100 })

    await changeStatus(f.ctx, f.funcionario, ticket.id, 'RESOLVIDO')
    const blockedForm = new FormData()
    blockedForm.append('file', new Blob(['x'], { type: 'text/plain' }), 'bloqueado.txt')
    const blocked = await fetch(new URL(`/tickets/${ticket.id}/attachments`, f.ctx.baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${f.aluno.accessToken}` }, body: blockedForm,
    })
    expect(blocked.status).toBe(409)
  })
})
