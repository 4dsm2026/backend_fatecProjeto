/**
 * Produto: Comunicações (templates de e-mail)
 * Cobre listagem, salvar (upsert) e envio de teste — restrito a ADMINISTRADOR.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))
vi.mock('../../src/security/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}))

// Mock do driver de e-mail: registra os envios sem tocar em SES/Resend.
const sendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/config/mail', () => ({
  getMailDriver: () => ({ send: sendMock }),
}))

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeAdminToken, makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

let app: FastifyInstance
let adminToken: string
let alunoToken: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  adminToken = makeAdminToken()
  alunoToken = makeUserToken({ role: 'USUARIO' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
  sendMock.mockClear()
  sendMock.mockResolvedValue(undefined)
})

describe('GET /admin/comunicacoes', () => {
  it('200 — retorna os templates persistidos', async () => {
    prismaMock.comunicacaoTemplate.findMany.mockResolvedValue([
      { id: 't1', chave: 'TICKET_OPENED', nome: 'Chamado aberto', habilitado: true, assunto: 'x', corpo: 'y' },
    ])
    const res = await app.inject({ method: 'GET', url: '/admin/comunicacoes', headers: bearerAuth(adminToken) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('403 — aluno não acessa', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/comunicacoes', headers: bearerAuth(alunoToken) })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /admin/comunicacoes/:chave', () => {
  it('200 — salva (upsert) um template', async () => {
    prismaMock.comunicacaoTemplate.upsert.mockResolvedValue({ id: 't1', chave: 'TICKET_OPENED', nome: 'Chamado aberto' })
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/comunicacoes/TICKET_OPENED',
      headers: bearerAuth(adminToken),
      payload: { nome: 'Chamado aberto', habilitado: true, assunto: 'Chamado {{chamado.protocolo}}', corpo: 'Olá {{aluno.nome}}' },
    })
    expect(res.statusCode).toBe(200)
    expect(prismaMock.comunicacaoTemplate.upsert).toHaveBeenCalled()
  })

  it('400 — corpo vazio é rejeitado', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/comunicacoes/TICKET_OPENED',
      headers: bearerAuth(adminToken),
      payload: { nome: 'x', assunto: 'y', corpo: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /admin/comunicacoes/teste', () => {
  it('200 — envia e-mail de teste com placeholders resolvidos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/comunicacoes/teste',
      headers: bearerAuth(adminToken),
      payload: { to: 'admin@fatec.sp.gov.br', assunto: 'Chamado {{chamado.protocolo}}', corpo: 'Olá {{aluno.nome}}' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const arg = sendMock.mock.calls[0][0]
    // Placeholders substituídos pela amostra, não enviados crus.
    expect(arg.html).toContain('Maria Aluna')
    expect(arg.subject).not.toContain('{{')
  })

  it('403 — aluno não pode disparar teste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/comunicacoes/teste',
      headers: bearerAuth(alunoToken),
      payload: { to: 'x@y.com', assunto: 'a', corpo: 'b' },
    })
    expect(res.statusCode).toBe(403)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
