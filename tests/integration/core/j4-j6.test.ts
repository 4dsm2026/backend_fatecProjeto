import { describe, expect, inject, it } from 'vitest'
import { createTicket } from '../_helpers/tickets'
import { waitForEmail } from '../_helpers/mailbox'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { ticketRequest } from '../tickets/fixtures'

describe('Jornadas de isolamento e notificações', () => {
  it('J4: outro aluno não acessa o chamado e o dono não recebe link de arquivamento', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const owner = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`)
    expect(owner.status).toBe(200)
    const resource = await owner.json() as { _links: Record<string, unknown> }
    expect(resource._links).not.toHaveProperty('archive')
    expect(resource._links).not.toHaveProperty('update')
    const other = await ticketRequest(f.ctx, f.outroAluno, `/tickets/${ticket.id}`)
    expect(other.status).toBe(404)
    const archive = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`, {
      method: 'PATCH', body: JSON.stringify({ arquivado: true }),
    })
    expect(archive.status).toBe(403)
  })

  it('J6: evento chega ao funcionário do setor e pode ser marcado como lido', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const list = await ticketRequest(f.ctx, f.funcionario, '/notifications?apenasNaoLidas=true&page=0&size=100')
    expect(list.status).toBe(200)
    const collection = await list.json() as {
      _embedded: { notifications: Array<{ chamadoId: string | null; tipo: string; _links: { ticket?: { href: string } } }> }
      _links: Record<string, { href: string; method: string }>
    }
    const notification = collection._embedded.notifications.find(item => item.chamadoId === ticket.id && item.tipo === 'CHAMADO_CRIADO')
    expect(notification?._links.ticket?.href).toBe(`/tickets/${ticket.id}`)
    expect(collection._links['mark-all-read']).toMatchObject({ href: '/notifications', method: 'PATCH' })
    const marked = await ticketRequest(f.ctx, f.funcionario, collection._links['mark-all-read'].href, {
      method: 'PATCH', body: JSON.stringify({ lida: true }),
    })
    expect(marked.status).toBe(200)
    const remaining = await ticketRequest(f.ctx, f.funcionario, '/notifications?apenasNaoLidas=true&page=0&size=100')
    expect((await remaining.json()).page.totalElements).toBe(0)
  })

  it('J6: funcionário que desativa notificações internas não recebe aviso do chamado', async () => {
    const f = await prepareTicketFixtures()
    const update = await ticketRequest(f.ctx, f.admin, `/users/${f.funcionario.userId}`, {
      method: 'PATCH', body: JSON.stringify({ notificacoesInApp: false }),
    })
    expect(update.status).toBe(200)
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const list = await ticketRequest(f.ctx, f.funcionario, '/notifications?page=0&size=100')
    expect(list.status).toBe(200)
    const collection = await list.json() as { _embedded: { notifications: Array<{ chamadoId: string | null }> } }
    expect(collection._embedded.notifications.some(item => item.chamadoId === ticket.id)).toBe(false)
  })

  it('J6: envia e-mail apenas quando o funcionário escolhe recebê-lo', async () => {
    const f = await prepareTicketFixtures()
    const path = `/users/${f.funcionario.userId}`
    const profile = await ticketRequest(f.ctx, f.funcionario, path)
    expect(profile.status).toBe(200)
    const { emailPessoal } = await profile.json() as { emailPessoal: string }
    const enable = await ticketRequest(f.ctx, f.funcionario, path, {
      method: 'PATCH', body: JSON.stringify({ notificacoesEmail: true, notificacoesInApp: false }),
    })
    expect(enable.status).toBe(200)
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    expect((await waitForEmail(emailPessoal, 'Chamado criado')).to).toContain(emailPessoal)
    const message = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}/messages`, {
      method: 'POST', body: JSON.stringify({ conteudo: 'Mensagem para a equipe' }),
    })
    expect(message.status).toBe(201)
    expect((await waitForEmail(emailPessoal, 'Nova mensagem no chamado')).to).toContain(emailPessoal)
    const disable = await ticketRequest(f.ctx, f.funcionario, path, {
      method: 'PATCH', body: JSON.stringify({ notificacoesEmail: false }),
    })
    expect(disable.status).toBe(200)
    const mailbox = inject('integrationMailboxUrl')
    expect((await fetch(`${mailbox}/__mailbox`, { method: 'DELETE' })).status).toBe(204)
    await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const messages = await fetch(`${mailbox}/__mailbox?to=${encodeURIComponent(emailPessoal)}`)
    expect(await messages.json()).toEqual([])
  })
})
