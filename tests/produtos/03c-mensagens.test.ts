/**
 * Produto: Mensagens do chamado (ticket-messages) — REST nível 3
 *
 * Cobre: POST (201 + Location, regras 404/409, volta para EM_ATENDIMENTO),
 * GET lista (HAL, base 0, filtro nos links), GET de uma mensagem e o fim das rotas antigas.
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
import { makeUserToken, makeAdminToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let userToken: string
let adminToken: string

const DIA_MS = 24 * 60 * 60 * 1000
const MENSAGENS = `/tickets/${IDS.ticket}/messages`

const makeMensagem = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg-id-001',
  chamadoId: IDS.ticket,
  autorId: IDS.user,
  conteudo: 'Olá, preciso de ajuda',
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  deletadoEm: null,
  autor: { id: IDS.user, nome: 'João Silva', emailPessoal: 'joao@example.com' },
  ...overrides,
})

/** Todo erro da API é application/problem+json (RFC 7807) com o status no corpo. */
const expectProblem = (res: { statusCode: number; headers: Record<string, unknown>; json: () => any }, status: number) => {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toContain('application/problem+json')
  expect(res.json()).toMatchObject({ status })
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  userToken = makeUserToken()
  adminToken = makeAdminToken()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
  prismaMock.notificacao.create.mockResolvedValue({})
  prismaMock.usuarioSetor.findMany.mockResolvedValue([])
  prismaMock.historicoStatusChamado.create.mockResolvedValue({})
  prismaMock.chamado.findUnique.mockResolvedValue(null)
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /tickets/:id/messages — Criar mensagem', () => {
  const responder = (token: string, payload: object = { conteudo: 'Olá, preciso de ajuda' }) =>
    app.inject({ method: 'POST', url: MENSAGENS, headers: bearerAuth(token), payload })

  it('201 — aluno dono responde: Location, corpo e _links', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    prismaMock.mensagem.create.mockResolvedValueOnce(makeMensagem())

    const res = await responder(userToken)

    expect(res.statusCode).toBe(201)
    expect(res.headers.location).toBe(`${MENSAGENS}/msg-id-001`)
    const body = res.json()
    expect(body).toMatchObject({ id: 'msg-id-001', conteudo: 'Olá, preciso de ajuda' })
    expect(body._links.self).toMatchObject({ href: `${MENSAGENS}/msg-id-001`, method: 'GET' })
    expect(body._links.collection).toMatchObject({ href: MENSAGENS })
    expect(body._links.ticket).toMatchObject({ href: `/tickets/${IDS.ticket}` })
  })

  it('201 — equipe também responde', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket({ status: 'EM_ATENDIMENTO' }))
    prismaMock.mensagem.create.mockResolvedValueOnce(makeMensagem({ autorId: IDS.admin }))

    const res = await responder(adminToken)

    expect(res.statusCode).toBe(201)
  })

  it.each([
    ['RESOLVIDO', { status: 'RESOLVIDO', encerradoEm: new Date() }],
    ['ENCERRADO', { status: 'ENCERRADO', encerradoEm: new Date() }],
    ['ENCERRADO há mais de 30 dias', { status: 'ENCERRADO', encerradoEm: new Date(Date.now() - 31 * DIA_MS) }],
    ['arquivado', { arquivadoEm: new Date() }],
  ])('409 — chamado %s não aceita mensagem (aluno e equipe)', async (_estado, overrides) => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket(overrides))

    const doAluno = await responder(userToken)
    const daEquipe = await responder(adminToken)

    expectProblem(doAluno, 409)
    expectProblem(daEquipe, 409)
    expect(prismaMock.mensagem.create).not.toHaveBeenCalled()
  })

  it('201 — dono responde em AGUARDANDO_USUARIO: o chamado volta para EM_ATENDIMENTO', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket({ status: 'AGUARDANDO_USUARIO' }))
    prismaMock.mensagem.create.mockResolvedValueOnce(makeMensagem())
    prismaMock.chamado.update.mockResolvedValue(makeTicket({ status: 'EM_ATENDIMENTO' }))

    const res = await responder(userToken)

    expect(res.statusCode).toBe(201)
    expect(prismaMock.chamado.update.mock.calls[0][0].data.status).toBe('EM_ATENDIMENTO')
  })

  it('201 — equipe responde em AGUARDANDO_USUARIO e o status não muda', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket({ status: 'AGUARDANDO_USUARIO' }))
    prismaMock.mensagem.create.mockResolvedValueOnce(makeMensagem({ autorId: IDS.admin }))

    const res = await responder(adminToken)

    expect(res.statusCode).toBe(201)
    expect(prismaMock.chamado.update).not.toHaveBeenCalled()
  })

  it('404 — aluno que não é dono recebe a mesma resposta do inexistente', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    const intruso = makeUserToken({ sub: 'outro-aluno-id', role: 'USUARIO' })

    const res = await responder(intruso)

    expectProblem(res, 404)
    expect(prismaMock.mensagem.create).not.toHaveBeenCalled()
  })

  it('404 — chamado inexistente (equipe)', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(null)

    const res = await responder(adminToken)

    expectProblem(res, 404)
  })

  it('400 — conteúdo vazio vem em problem+json com errors', async () => {
    const res = await responder(userToken, { conteudo: '' })

    expectProblem(res, 400)
    expect(Array.isArray(res.json().errors)).toBe(true)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: MENSAGENS, payload: { conteudo: 'Oi' } })

    expectProblem(res, 401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/:id/messages — Listar mensagens', () => {
  const listar = (url: string, token: string = userToken) =>
    app.inject({ method: 'GET', url, headers: bearerAuth(token) })

  it('200 — coleção HAL, primeira página é a 0 e o orderDir vai nos links', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    prismaMock.mensagem.count.mockResolvedValue(3)
    prismaMock.mensagem.findMany.mockResolvedValue([makeMensagem()])

    const res = await listar(`${MENSAGENS}?page=0&size=1&orderDir=desc`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body._embedded.messages).toHaveLength(1)
    expect(body._embedded.messages[0]._links.self).toMatchObject({ href: `${MENSAGENS}/msg-id-001` })
    expect(body.page).toMatchObject({ size: 1, number: 0, totalElements: 3, totalPages: 3 })
    expect(body._links.next.href).toContain('page=1')
    expect(body._links.next.href).toContain('orderDir=desc')
    expect(body._links.prev).toBeUndefined()
    expect(prismaMock.mensagem.findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 1,
      orderBy: { criadoEm: 'desc' },
    })
  })

  it('200 — sem parâmetros: página 0, 20 itens, mais antigas primeiro', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    prismaMock.mensagem.count.mockResolvedValue(0)
    prismaMock.mensagem.findMany.mockResolvedValue([])

    const res = await listar(MENSAGENS)

    expect(res.statusCode).toBe(200)
    expect(res.json().page).toMatchObject({ size: 20, number: 0 })
    expect(prismaMock.mensagem.findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 20,
      orderBy: { criadoEm: 'asc' },
    })
  })

  it('400 — page negativo e size acima do máximo', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())

    expectProblem(await listar(`${MENSAGENS}?page=-1`), 400)
    expectProblem(await listar(`${MENSAGENS}?size=101`), 400)
  })

  it('404 — aluno que não é dono do chamado', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    const intruso = makeUserToken({ sub: 'outro-aluno-id', role: 'USUARIO' })

    const res = await listar(MENSAGENS, intruso)

    expectProblem(res, 404)
    expect(prismaMock.mensagem.findMany).not.toHaveBeenCalled()
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: MENSAGENS })

    expectProblem(res, 401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /tickets/:id/messages/:messageId — Uma mensagem', () => {
  it('200 — devolve a mensagem com _links', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    prismaMock.mensagem.findFirst.mockResolvedValue(makeMensagem())

    const res = await app.inject({ method: 'GET', url: `${MENSAGENS}/msg-id-001`, headers: bearerAuth(userToken) })

    expect(res.statusCode).toBe(200)
    expect(res.json()._links.self).toMatchObject({ href: `${MENSAGENS}/msg-id-001` })
    expect(prismaMock.mensagem.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'msg-id-001',
      chamadoId: IDS.ticket,
    })
  })

  it('404 — mensagem inexistente, em problem+json', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue(makeTicket())
    prismaMock.mensagem.findFirst.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: `${MENSAGENS}/nao-existe`, headers: bearerAuth(userToken) })

    expectProblem(res, 404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Rotas antigas (/mensagens) — removidas', () => {
  it.each(['GET', 'POST'] as const)('%s /tickets/:id/mensagens não existe mais', async (method) => {
    const res = await app.inject({
      method,
      url: `/tickets/${IDS.ticket}/mensagens`,
      headers: bearerAuth(userToken),
      payload: method === 'POST' ? { conteudo: 'Oi' } : undefined,
    })

    expect([404, 405]).toContain(res.statusCode)
    expect(prismaMock.mensagem.create).not.toHaveBeenCalled()
  })
})