/**
 * Segurança: controle de acesso (IDOR / escalonamento de privilégio)
 * Cobre as regras adicionadas para papel USUARIO (aluno):
 *  - não acessa chamados de outros alunos (GET/PATCH/DELETE/mensagens)
 *  - não altera papel/ativo de ninguém via PATCH /usuarios/:id
 *  - não edita o cadastro de outro usuário
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
import { makeTicket, makeUser, IDS } from '../helpers/factories'
import { makeAdminToken, makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let adminToken: string
let alunoDonoToken: string
let alunoIntrusoToken: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  adminToken = makeAdminToken()
  alunoDonoToken = makeUserToken({ sub: IDS.user, role: 'USUARIO' })
  alunoIntrusoToken = makeUserToken({ sub: 'outro-aluno-999', role: 'USUARIO' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
  prismaMock.notificacao.create.mockResolvedValue({})
  prismaMock.usuarioSetor.findMany.mockResolvedValue([])
  prismaMock.historicoStatusChamado.create.mockResolvedValue({})
})

// ─────────────────────────────────────────────────────────────────────────────
describe('IDOR — chamados de outro aluno', () => {
  // O chamado pertence a IDS.user; quem tenta acessar é "outro-aluno-999".
  it('GET /tickets/:id — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it('PATCH /tickets/:id — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(alunoIntrusoToken),
      payload: { status: 'ENCERRADO' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('DELETE /tickets/:id — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'DELETE',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it('GET /tickets/:id/mensagens — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}/mensagens`,
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it('POST /tickets/:id/mensagens — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'POST',
      url: `/tickets/${IDS.ticket}/mensagens`,
      headers: bearerAuth(alunoIntrusoToken),
      payload: { conteudo: 'tentando espiar' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('GET /tickets/:id — dono do chamado acessa normalmente (200)', async () => {
    const ticket = makeTicket({ criadoPorId: IDS.user })
    // 1ª chamada: verificação de posse; 2ª: carga completa do chamado.
    prismaMock.chamado.findFirst
      .mockResolvedValueOnce({ criadoPorId: IDS.user })
      .mockResolvedValueOnce({ ...ticket, mensagens: [], historico: [] })

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(alunoDonoToken),
    })

    expect(res.statusCode).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('IDOR — anexos de chamado de outro aluno', () => {
  it('GET /tickets/:id/anexos — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}/anexos`,
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.anexo.findMany).not.toHaveBeenCalled()
  })

  it('POST /tickets/:id/anexos — 404 para aluno que não é dono', async () => {
    prismaMock.chamado.findFirst.mockResolvedValue({ criadoPorId: IDS.user })

    const res = await app.inject({
      method: 'POST',
      url: `/tickets/${IDS.ticket}/anexos`,
      headers: bearerAuth(alunoIntrusoToken),
      payload: {},
    })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.anexo.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('IDOR — marcar notificação de outro usuário como lida', () => {
  it('PATCH /notifications/:id/lida escopa a atualização por usuarioId', async () => {
    prismaMock.notificacao.updateMany.mockResolvedValue({ count: 1 })

    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/notif-de-outro/lida',
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect([200, 204]).toContain(res.statusCode)
    // A cláusula where DEVE conter o usuarioId de quem chama (não só o id).
    const arg = prismaMock.notificacao.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ id: 'notif-de-outro', usuarioId: 'outro-aluno-999' })
  })

  it('PATCH /notifications/:id/lida — 404 quando não há match (id de outro dono)', async () => {
    prismaMock.notificacao.updateMany.mockResolvedValue({ count: 0 })

    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/notif-de-outro/lida',
      headers: bearerAuth(alunoIntrusoToken),
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Escalonamento de privilégio — PATCH /usuarios/:id', () => {
  it('403 quando aluno tenta se promover a ADMINISTRADOR', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoDonoToken),
      payload: { papel: 'ADMINISTRADOR' },
    })

    expect(res.statusCode).toBe(403)
    // Nenhuma escrita deve ter chegado ao banco.
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('403 quando aluno tenta alterar "ativo"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoDonoToken),
      payload: { ativo: false },
    })

    expect(res.statusCode).toBe(403)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('403 quando aluno tenta editar o cadastro de outro usuário', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoIntrusoToken),
      payload: { nome: 'Nome Alterado' },
    })

    expect(res.statusCode).toBe(403)
    expect(prismaMock.usuario.update).not.toHaveBeenCalled()
  })

  it('200 quando aluno edita os próprios dados de contato', async () => {
    const before = makeUser({ id: IDS.user })
    const after = makeUser({ id: IDS.user, nome: 'João Atualizado' })
    prismaMock.usuario.findUnique.mockResolvedValue(before)
    prismaMock.usuario.update.mockResolvedValue(after)

    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(alunoDonoToken),
      payload: { nome: 'João Atualizado', telefoneCelular: '11999998888' },
    })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalled()
  })

  it('200 quando ADMINISTRADOR altera papel (fluxo legítimo)', async () => {
    const before = makeUser({ id: IDS.user })
    const after = makeUser({ id: IDS.user, papel: 'TECNICO' })
    prismaMock.usuario.findUnique.mockResolvedValue(before)
    prismaMock.usuario.update.mockResolvedValue(after)

    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.user}`,
      headers: bearerAuth(adminToken),
      payload: { papel: 'TECNICO' },
    })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.usuario.update).toHaveBeenCalled()
  })
})
