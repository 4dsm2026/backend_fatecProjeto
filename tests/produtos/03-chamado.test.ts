/**
 * Produto: Chamados (Tickets)
 * Cobre: abrir chamado, listar, buscar, atualizar status, fechar, stats
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeTicket, IDS } from '../helpers/factories'
import { makeAdminToken, makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let adminToken: string
let userToken: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  adminToken = makeAdminToken()
  userToken = makeUserToken()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
  prismaMock.notificacao.create.mockResolvedValue({})
  prismaMock.usuarioSetor.findMany.mockResolvedValue([])
  prismaMock.historicoStatusChamado.create.mockResolvedValue({})
  prismaMock.setor.findFirst.mockResolvedValue(null)
  prismaMock.chamado.findUnique.mockResolvedValue(null)
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /tickets — Abrir Chamado', () => {
  it('201 — abre chamado com dados mínimos', async () => {
    const ticket = makeTicket()
    prismaMock.chamado.create.mockResolvedValueOnce(ticket)
    prismaMock.chamado.findFirst.mockResolvedValueOnce({ ...ticket, servico: null, criadoPor: null })

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: {
        titulo: 'Não consigo logar no portal',
        descricao: 'Ao tentar acessar o SIGA, recebo erro de credenciais',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({ titulo: 'Problema de acesso ao portal', protocolo: 'TCK-ABC123' })
  })

  it('201 — abre chamado com servicoId do catálogo (slug)', async () => {
    const ticket = makeTicket({ catalogoServicoId: 'secretaria-declaracao-matricula' })
    prismaMock.chamado.create.mockResolvedValueOnce(ticket)
    prismaMock.chamado.findFirst.mockResolvedValueOnce({ ...ticket, servico: null, criadoPor: null })

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: {
        titulo: 'Declaração de Matrícula',
        descricao: 'Preciso de declaração para o trabalho',
        servicoId: 'secretaria-declaracao-matricula',
        camposEspecificos: { finalidade: 'emprego' },
      },
    })

    expect(res.statusCode).toBe(201)
  })

  it('400 — body inválido (título muito curto)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: {
        titulo: 'Ab',
        descricao: 'Ok',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        titulo: 'Sem auth',
        descricao: 'Deve retornar 401',
      },
    })

    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets — Listar Chamados', () => {
  it('200 — aluno vê apenas seus próprios chamados', async () => {
    const ticket = makeTicket()
    prismaMock.chamado.count.mockResolvedValueOnce(1)
    prismaMock.chamado.findMany.mockResolvedValueOnce([ticket])

    const res = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('items')
    expect(body).toHaveProperty('total', 1)
  })

  it('200 — admin pode listar todos os chamados', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(2)
    prismaMock.chamado.findMany.mockResolvedValueOnce([makeTicket(), makeTicket({ id: 'ticket-002' })])

    const res = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(2)
  })

  it('200 — filtra por status=ABERTO', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(1)
    prismaMock.chamado.findMany.mockResolvedValueOnce([makeTicket()])

    const res = await app.inject({
      method: 'GET',
      url: '/tickets?status=ABERTO',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' })
    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/stats — Estatísticas', () => {
  it('200 — retorna contagens por status', async () => {
    // statsTickets calls count × 5 (one per status), findMany × 1, groupBy × 4
    prismaMock.chamado.count
      .mockResolvedValue(1) // default for all status counts
    prismaMock.chamado.findMany.mockResolvedValue([]) // encerrados
    prismaMock.chamado.groupBy.mockResolvedValue([])  // porSetor, porResponsavel, nivelGroups, prioGroups

    const res = await app.inject({
      method: 'GET',
      url: '/tickets/stats',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('porStatus')
    expect(body.porStatus).toHaveProperty('ABERTO')
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/stats' })
    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/:id — Buscar Chamado', () => {
  it('200 — retorna chamado existente', async () => {
    const ticket = makeTicket()
    prismaMock.chamado.findFirst.mockResolvedValueOnce(ticket)

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: IDS.ticket, protocolo: 'TCK-ABC123' })
  })

  it('404 — chamado não existe', async () => {
    prismaMock.chamado.findFirst.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'GET',
      url: '/tickets/id-inexistente',
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /tickets/:id — Atualizar Chamado', () => {
  it('200 — atualiza status do chamado para EM_ATENDIMENTO', async () => {
    const before = makeTicket()
    const after = { ...makeTicket(), status: 'EM_ATENDIMENTO' }
    prismaMock.chamado.findFirst.mockResolvedValueOnce(before)
    prismaMock.chamado.update.mockResolvedValueOnce(after)

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(adminToken),
      payload: { status: 'EM_ATENDIMENTO' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'EM_ATENDIMENTO' })
  })

  it('200 — encerra chamado (status ENCERRADO)', async () => {
    const before = makeTicket({ status: 'EM_ATENDIMENTO' })
    const after = {
      ...makeTicket(),
      status: 'ENCERRADO',
      encerradoEm: new Date(),
    }
    prismaMock.chamado.findFirst.mockResolvedValueOnce(before)
    prismaMock.chamado.update.mockResolvedValueOnce(after)

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(adminToken),
      payload: { status: 'ENCERRADO' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ENCERRADO' })
  })

  it('404 — chamado não encontrado para update', async () => {
    prismaMock.chamado.findFirst.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/ghost-id',
      headers: bearerAuth(adminToken),
      payload: { status: 'ENCERRADO' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${IDS.ticket}`,
      payload: { status: 'ENCERRADO' },
    })

    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /tickets/:id — Fechar/Remover Chamado', () => {
  it('200 — soft delete com sucesso', async () => {
    const ticket = makeTicket()
    const deleted = { ...makeTicket(), deletadoEm: new Date() }
    prismaMock.chamado.findFirst.mockResolvedValueOnce(ticket)
    prismaMock.chamado.update.mockResolvedValueOnce(deleted)

    const res = await app.inject({
      method: 'DELETE',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
  })

  it('404 — chamado não encontrado para remoção', async () => {
    const err: any = new Error('Not found')
    err.code = 'P2025'
    prismaMock.chamado.findFirst.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'DELETE',
      url: '/tickets/ghost-id',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(404)
  })
})
