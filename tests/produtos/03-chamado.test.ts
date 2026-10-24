/**
 * Produto: Chamados (Tickets)
 * Cobre: abrir (201 + Location), listar (HAL, base 0), buscar (links por papel/estado),
 * atualizar (regras 403/409, arquivar), fim do DELETE, ticket-stats e S1
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

const DIA_MS = 24 * 60 * 60 * 1000
const tecnicoToken = () => makeUserToken({ sub: 'tecnico-id-001', role: 'TECNICO', email: 'tecnico@test.com' })

/** Todo erro da API é application/problem+json (RFC 7807) com o status no corpo. */
const expectProblem = (res: { statusCode: number; headers: Record<string, unknown>; json: () => any }, status: number) => {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toContain('application/problem+json')
  expect(res.json()).toMatchObject({ status })
}

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

  it('201 — roteia por setorProvavel mais específico que o nome do setor', async () => {
    // setorProvavel "Secretaria Acadêmica" deve casar com o setor "Secretaria"
    // (matching bidirecional) — sem isso o chamado nasceria órfão.
    const ticket = makeTicket()
    prismaMock.setor.findFirst.mockResolvedValueOnce(null) // sem match direto por contains
    prismaMock.setor.findMany.mockResolvedValueOnce([{ id: 'setor-secretaria', nome: 'Secretaria' }])
    prismaMock.chamado.create.mockResolvedValueOnce(ticket)
    prismaMock.chamado.findFirst.mockResolvedValueOnce({ ...ticket, servico: null, criadoPor: null })

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: {
        titulo: 'Solicitação para a secretaria',
        descricao: 'Preciso resolver uma pendência acadêmica no sistema',
        setorProvavel: 'Secretaria Acadêmica',
      },
    })

    expect(res.statusCode).toBe(201)
    const createArg = prismaMock.chamado.create.mock.calls[0][0]
    expect(createArg.data.setorId).toBe('setor-secretaria')
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
    expect(body._embedded.tickets).toHaveLength(1)
    expect(body.page.totalElements).toBe(1)
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
    expect(res.json().page.totalElements).toBe(2)
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
describe('GET /tickets/stats — endereço antigo, removido', () => {
  it('não existe mais (as estatísticas moram em /ticket-stats)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tickets/stats',
      headers: bearerAuth(adminToken),
    })

    expect([404, 405]).toContain(res.statusCode)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/:id — Buscar Chamado', () => {
  it('200 — retorna chamado existente', async () => {
    const ticket = makeTicket()
    // 1ª chamada: verificação de posse (IDOR); 2ª: carga completa do chamado.
    prismaMock.chamado.findFirst
      .mockResolvedValueOnce({ criadoPorId: ticket.criadoPorId })
      .mockResolvedValueOnce(ticket)

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
  const patch = (token: string, payload: object, id: string = IDS.ticket) =>
    app.inject({ method: 'PATCH', url: `/tickets/${id}`, headers: bearerAuth(token), payload })

  // O controller lê o chamado (para as regras) e o service lê de novo (para o update):
  // por isso mockResolvedValue (vale para as duas leituras), e não mockResolvedValueOnce.
  const chamadoAtual = (overrides: Record<string, unknown> = {}) => {
    const ticket = makeTicket(overrides)
    prismaMock.chamado.findFirst.mockResolvedValue(ticket)
    return ticket
  }
  const dadosDoUpdate = () => prismaMock.chamado.update.mock.calls[0][0].data

  it('200 — equipe muda para EM_ATENDIMENTO e recebe _links', async () => {
    chamadoAtual()
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket({ status: 'EM_ATENDIMENTO' }))

    const res = await patch(adminToken, { status: 'EM_ATENDIMENTO' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'EM_ATENDIMENTO' })
    expect(res.json()._links.self).toMatchObject({ href: `/tickets/${IDS.ticket}`, method: 'GET' })
  })

  it('200 — encerrar grava encerradoEm', async () => {
    chamadoAtual({ status: 'EM_ATENDIMENTO' })
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket({ status: 'ENCERRADO', encerradoEm: new Date() }))

    const res = await patch(adminToken, { status: 'ENCERRADO' })

    expect(res.statusCode).toBe(200)
    expect(dadosDoUpdate().encerradoEm).toBeInstanceOf(Date)
  })

  it('200 — reabrir dentro do prazo limpa encerradoEm', async () => {
    chamadoAtual({ status: 'ENCERRADO', encerradoEm: new Date() })
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket({ status: 'EM_ATENDIMENTO' }))

    const res = await patch(adminToken, { status: 'EM_ATENDIMENTO' })

    expect(res.statusCode).toBe(200)
    expect(dadosDoUpdate().encerradoEm).toBeNull()
  })

  it('409 — reabrir depois de 30 dias do encerramento', async () => {
    chamadoAtual({ status: 'ENCERRADO', encerradoEm: new Date(Date.now() - 31 * DIA_MS) })

    const res = await patch(adminToken, { status: 'EM_ATENDIMENTO' })

    expectProblem(res, 409)
    expect(res.json().detail).toContain('30')
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('409 — transição que a equipe não pode fazer (ENCERRADO → RESOLVIDO)', async () => {
    chamadoAtual({ status: 'ENCERRADO', encerradoEm: new Date() })

    const res = await patch(adminToken, { status: 'RESOLVIDO' })

    expectProblem(res, 409)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('403 — aluno dono não muda a prioridade (S5/S6)', async () => {
    chamadoAtual()

    const res = await patch(userToken, { prioridade: 'URGENTE' })

    expectProblem(res, 403)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('403 — aluno dono não muda o responsável (S5/S6)', async () => {
    chamadoAtual()

    const res = await patch(userToken, { responsavelId: 'outro-usuario' })

    expectProblem(res, 403)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('403 — aluno dono não pode iniciar o atendimento (ABERTO → EM_ATENDIMENTO)', async () => {
    chamadoAtual()

    const res = await patch(userToken, { status: 'EM_ATENDIMENTO' })

    expectProblem(res, 403)
  })

  it('200 — aluno dono encerra um chamado RESOLVIDO', async () => {
    chamadoAtual({ status: 'RESOLVIDO', encerradoEm: new Date() })
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket({ status: 'ENCERRADO', encerradoEm: new Date() }))

    const res = await patch(userToken, { status: 'ENCERRADO' })

    expect(res.statusCode).toBe(200)
  })

  it('200 — administrador arquiva: grava arquivadoEm, audita e troca o link archive por unarchive', async () => {
    chamadoAtual()
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket({ arquivadoEm: new Date() }))

    const res = await patch(adminToken, { arquivado: true })

    expect(res.statusCode).toBe(200)
    expect(dadosDoUpdate().arquivadoEm).toBeInstanceOf(Date)
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: 'ARQUIVAR_CHAMADO' }) }),
    )
    expect(res.json()._links.unarchive).toBeDefined()
    expect(res.json()._links.archive).toBeUndefined()
  })

  it('200 — administrador desarquiva: limpa arquivadoEm', async () => {
    chamadoAtual({ arquivadoEm: new Date() })
    prismaMock.chamado.update.mockResolvedValueOnce(makeTicket())

    const res = await patch(adminToken, { arquivado: false })

    expect(res.statusCode).toBe(200)
    expect(dadosDoUpdate().arquivadoEm).toBeNull()
  })

  it('403 — técnico não arquiva (só o administrador)', async () => {
    chamadoAtual()

    const res = await patch(tecnicoToken(), { arquivado: true })

    expectProblem(res, 403)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('409 — arquivar um chamado que já está arquivado', async () => {
    chamadoAtual({ arquivadoEm: new Date() })

    const res = await patch(adminToken, { arquivado: true })

    expectProblem(res, 409)
  })

  it('409 — chamado arquivado é somente leitura', async () => {
    chamadoAtual({ arquivadoEm: new Date() })

    const res = await patch(adminToken, { prioridade: 'ALTA' })

    expectProblem(res, 409)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('400 — corpo vazio vem em problem+json', async () => {
    const res = await patch(adminToken, {})

    expectProblem(res, 400)
  })

  it('404 — chamado não encontrado para update', async () => {
    prismaMock.chamado.findFirst.mockResolvedValueOnce(null)

    const res = await patch(adminToken, { status: 'ENCERRADO' }, 'ghost-id')

    expectProblem(res, 404)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${IDS.ticket}`,
      payload: { status: 'ENCERRADO' },
    })

    expectProblem(res, 401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /tickets/:id — removido (chamado não se apaga, só se arquiva)', () => {
  it('a rota não existe mais e nada é gravado', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(adminToken),
    })

    expect([404, 405]).toContain(res.statusCode)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /ticket-stats — Estatísticas (rota nova)', () => {
  const mockStats = () => {
    prismaMock.chamado.count.mockResolvedValue(1)
    prismaMock.chamado.findMany.mockResolvedValue([])
    prismaMock.chamado.groupBy.mockResolvedValue([])
  }

  it('200 — equipe recebe as contagens e o _links.self', async () => {
    mockStats()

    const res = await app.inject({ method: 'GET', url: '/ticket-stats', headers: bearerAuth(adminToken) })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('porStatus')
    expect(res.json()._links.self).toMatchObject({ href: '/ticket-stats' })
  })

  it('403 — aluno não acessa, em problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/ticket-stats', headers: bearerAuth(userToken) })

    expectProblem(res, 403)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/ticket-stats' })

    expectProblem(res, 401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /tickets — Location e links', () => {
  it('201 — devolve o header Location e os _links do dono', async () => {
    const ticket = makeTicket()
    prismaMock.chamado.create.mockResolvedValueOnce(ticket)
    prismaMock.chamado.findFirst.mockResolvedValueOnce({ ...ticket, servico: null, criadoPor: null })

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: { titulo: 'Teste do Location', descricao: 'Conferindo o header e os links' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.headers.location).toBe(`/tickets/${IDS.ticket}`)
    expect(res.json()._links.self).toMatchObject({ href: `/tickets/${IDS.ticket}`, method: 'GET' })
    expect(res.json()._links.reply).toBeDefined()
  })

  it('400 — título curto vem em problem+json com errors por campo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: bearerAuth(userToken),
      payload: { titulo: 'Ab', descricao: 'Ok' },
    })

    expectProblem(res, 400)
    expect(Array.isArray(res.json().errors)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets — HAL, paginação base 0 e filtros nos links', () => {
  const listar = (url: string, token: string = adminToken) =>
    app.inject({ method: 'GET', url, headers: bearerAuth(token) })

  it('200 — a primeira página é a 0 e o link next preserva o filtro', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(3)
    prismaMock.chamado.findMany.mockResolvedValueOnce([makeTicket()])

    const res = await listar('/tickets?status=ABERTO&page=0&size=1')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.page).toMatchObject({ size: 1, number: 0, totalElements: 3, totalPages: 3 })
    expect(body._links.next.href).toContain('page=1')
    expect(body._links.next.href).toContain('status=ABERTO')
    expect(body._links.prev).toBeUndefined()
    expect(prismaMock.chamado.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 1 })
  })

  it('200 — filtro repetido (status=A&status=B) continua nos links', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(2)
    prismaMock.chamado.findMany.mockResolvedValueOnce([makeTicket()])

    const res = await listar('/tickets?status=ABERTO&status=RESOLVIDO&size=1')

    const next: string = res.json()._links.next.href
    expect(next).toContain('status=ABERTO')
    expect(next).toContain('status=RESOLVIDO')
  })

  it('200 — cada chamado da lista traz o próprio _links', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(1)
    prismaMock.chamado.findMany.mockResolvedValueOnce([makeTicket()])

    const res = await listar('/tickets')

    expect(res.json()._embedded.tickets[0]._links.self).toMatchObject({ href: `/tickets/${IDS.ticket}` })
  })

  it('200 — aluno: o filtro por criador é forçado para o próprio id', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(0)
    prismaMock.chamado.findMany.mockResolvedValueOnce([])

    await listar('/tickets?criadoPorId=outro-aluno', userToken)

    const where = JSON.stringify(prismaMock.chamado.findMany.mock.calls[0][0].where)
    expect(where).toContain(IDS.user)
    expect(where).not.toContain('outro-aluno')
  })

  it('200 — S1: criadoPor e responsavel só pedem id, nome e emailPessoal', async () => {
    prismaMock.chamado.count.mockResolvedValueOnce(0)
    prismaMock.chamado.findMany.mockResolvedValueOnce([])

    await listar('/tickets?include=criadoPor,responsavel')

    const { include } = prismaMock.chamado.findMany.mock.calls[0][0]
    const publico = { select: { id: true, nome: true, emailPessoal: true } }
    expect(include.criadoPor).toEqual(publico)
    expect(include.responsavel).toEqual(publico)
  })

  it('401 — sem token vem em problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' })

    expectProblem(res, 401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/:id — links por papel e estado', () => {
  const abrir = (token: string, overrides: Record<string, unknown> = {}) => {
    // 1ª leitura: posse (aluno); 2ª: carga completa. A mesma resposta serve às duas.
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket(overrides))
    return app.inject({ method: 'GET', url: `/tickets/${IDS.ticket}`, headers: bearerAuth(token) })
  }

  it('200 — aluno dono de chamado ABERTO pode responder, mas não mexe no status nem arquiva', async () => {
    const res = await abrir(userToken)

    expect(res.statusCode).toBe(200)
    const links = res.json()._links
    expect(links.reply).toBeDefined()
    expect(links.transition ?? []).toHaveLength(0)
    expect(links.archive).toBeUndefined()
  })

  it('200 — administrador vê transição e arquivar', async () => {
    const res = await abrir(adminToken)

    const links = res.json()._links
    expect(links.transition.length).toBeGreaterThan(0)
    expect(links.archive).toBeDefined()
  })

  it('200 — técnico não vê o link de arquivar', async () => {
    const res = await abrir(tecnicoToken())

    expect(res.json()._links.archive).toBeUndefined()
  })

  it('200 — chamado RESOLVIDO: some o reply e aparece o reopen', async () => {
    const res = await abrir(userToken, { status: 'RESOLVIDO', encerradoEm: new Date() })

    const links = res.json()._links
    expect(links.reply).toBeUndefined()
    expect(links.reopen).toBeDefined()
  })

  it('200 — passados 30 dias, o reopen some', async () => {
    const res = await abrir(userToken, { status: 'ENCERRADO', encerradoEm: new Date(Date.now() - 31 * DIA_MS) })

    expect(res.json()._links.reopen).toBeUndefined()
  })

  it('404 — chamado inexistente, em problem+json', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/tickets/nao-existe', headers: bearerAuth(adminToken) })

    expectProblem(res, 404)
  })

  it('404 — aluno que não é dono recebe a mesma resposta do inexistente', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: 'outro-aluno' })

    const res = await app.inject({ method: 'GET', url: `/tickets/${IDS.ticket}`, headers: bearerAuth(userToken) })

    expectProblem(res, 404)
  })
})