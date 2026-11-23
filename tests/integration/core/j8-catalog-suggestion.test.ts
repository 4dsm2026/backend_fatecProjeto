import { PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createTicket } from '../_helpers/tickets'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'
import { ticketRequest } from '../tickets/fixtures'

describe('J8: catálogo, chamado e sugestão', () => {
  it('consulta serviço, abre chamado, cria sugestão e lê resposta com documentos', async () => {
    const f = await prepareTicketFixtures()
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    let serviceId: string
    try {
      const category = await prisma.categoria.create({ data: { nome: 'Categoria J8' } })
      const service = await prisma.servico.create({ data: { nome: 'Serviço J8', categoriaId: category.id, ativo: true } })
      serviceId = service.id
    } finally {
      await prisma.$disconnect()
    }
    const catalog = await ticketRequest(f.ctx, f.aluno, '/catalog')
    expect(catalog.status).toBe(200)
    const catalogBody = await catalog.json() as { categorias: Array<{ servicos: Array<{ id: string }> }> }
    expect(catalogBody.categorias.flatMap(category => category.servicos).some(service => service.id === serviceId)).toBe(true)
    const ticket = await createTicket(f.ctx, f.aluno, { servicoId: serviceId, setorId: f.setorId })
    expect(ticket.servicoId).toBe(serviceId)
    const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const suggestion = await ticketRequest(f.ctx, f.aluno, '/suggestions', {
      method: 'POST', body: JSON.stringify({ emailContato: 'j8@example.test', conteudo: 'Melhorar serviço', documento: doc('Melhorar serviço') }),
    })
    expect(suggestion.status).toBe(201)
    const created = await suggestion.json() as { id: string }
    const answer = await ticketRequest(f.ctx, f.admin, `/suggestions/${created.id}`, {
      method: 'PATCH', body: JSON.stringify({ resposta: 'Obrigado pela sugestão', respostaDocumento: doc('Obrigado pela sugestão') }),
    })
    expect(answer.status).toBe(200)
    const read = await ticketRequest(f.ctx, f.aluno, `/suggestions/${created.id}`)
    expect(read.status).toBe(200)
    const body = await read.json() as { status: string; documento: unknown; respostaDocumento: unknown }
    expect(body.status).toBe('RESPONDIDO')
    expect(body.documento).toEqual(doc('Melhorar serviço'))
    expect(body.respostaDocumento).toEqual(doc('Obrigado pela sugestão'))
  })
})
