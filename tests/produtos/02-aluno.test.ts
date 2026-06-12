/**
 * Produto: Usuários / Alunos
 * Cobre: criar aluno, criar funcionário, listar, buscar, atualizar, remover
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
import { makeUser, makeAluno, IDS } from '../helpers/factories'
import { makeAdminToken, makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'
import * as passwordModule from '../../src/security/password'

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
  vi.mocked(passwordModule.hashPassword).mockResolvedValue('hashed:password')
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /usuarios — Criar Aluno (com RA)', () => {
  it('201 — cria aluno com RA e e-mail educacional', async () => {
    const aluno = makeAluno()
    prismaMock.usuario.create.mockResolvedValueOnce(aluno)

    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Maria Aluna',
        emailEducacional: 'maria@fatec.sp.gov.br',
        ra: '1234567',
        papel: 'USUARIO',
        unidadeFatec: 'FATEC São Paulo',
        turno: 'Manhã',
        turma: '3SEM',
        semestreAtual: '3',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({ ra: '1234567', emailEducacional: 'maria@fatec.sp.gov.br' })
  })

  it('201 — cria aluno apenas com e-mail pessoal (sem educacional)', async () => {
    const aluno = makeAluno({ emailEducacional: null, emailPessoal: 'maria2@gmail.com' })
    prismaMock.usuario.create.mockResolvedValueOnce(aluno)

    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Maria Aluna 2',
        emailPessoal: 'maria2@gmail.com',
        ra: '7654321',
        papel: 'USUARIO',
      },
    })

    expect(res.statusCode).toBe(201)
  })

  it('400 — aluno sem nenhum e-mail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Sem E-mail',
        ra: '1111111',
        papel: 'USUARIO',
      },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /usuarios — Criar Funcionário (sem RA)', () => {
  it('201 — cria funcionário com e-mail pessoal e senha', async () => {
    const staff = makeUser({ papel: 'BACKOFFICE', nome: 'Carlos Backoffice' })
    prismaMock.usuario.create.mockResolvedValueOnce(staff)

    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Carlos Backoffice',
        emailPessoal: 'carlos@empresa.com',
        senha: 'Senha@1234',
        papel: 'BACKOFFICE',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ papel: 'BACKOFFICE' })
  })

  it('400 — funcionário sem senha', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Sem Senha',
        emailPessoal: 'semsenha@empresa.com',
        papel: 'TECNICO',
        // sem senha — deve falhar na validação
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('400 — funcionário sem e-mail pessoal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Sem Email',
        senha: 'Senha@1234',
        papel: 'TECNICO',
      },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /usuarios — Controle de Acesso', () => {
  it('401 — requisição sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      payload: { nome: 'Alguém', emailPessoal: 'x@x.com', senha: 'Abc@1234' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('403 — usuário comum não pode criar usuários', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(userToken),
      payload: {
        nome: 'Proibido',
        emailPessoal: 'proibido@example.com',
        senha: 'Abc@1234',
        papel: 'USUARIO',
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('409 — e-mail já em uso', async () => {
    const err: any = new Error('Email já está em uso')
    err.code = 'P2002'
    prismaMock.usuario.create.mockRejectedValueOnce(err)

    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
      payload: {
        nome: 'Duplicado',
        emailPessoal: 'joao@example.com',
        senha: 'Abc@1234',
        papel: 'USUARIO',
      },
    })

    expect(res.statusCode).toBe(409)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /usuarios — Listar', () => {
  it('200 — retorna lista paginada', async () => {
    const aluno = makeAluno()
    prismaMock.usuario.findMany.mockResolvedValueOnce([aluno])
    prismaMock.usuario.count.mockResolvedValueOnce(1)

    const res = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('items')
    expect(body).toHaveProperty('total', 1)
    expect(body.items).toHaveLength(1)
  })

  it('200 — filtra por papel=USUARIO', async () => {
    prismaMock.usuario.findMany.mockResolvedValueOnce([makeAluno()])
    prismaMock.usuario.count.mockResolvedValueOnce(1)

    const res = await app.inject({
      method: 'GET',
      url: '/usuarios?papel=USUARIO',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items[0]).toMatchObject({ papel: 'USUARIO' })
  })

  it('200 — busca por texto (q=)', async () => {
    prismaMock.usuario.findMany.mockResolvedValueOnce([makeAluno()])
    prismaMock.usuario.count.mockResolvedValueOnce(1)

    const res = await app.inject({
      method: 'GET',
      url: '/usuarios?q=Maria',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios' })
    expect(res.statusCode).toBe(401)
  })

  it('403 — papel USUARIO não tem acesso à listagem', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: bearerAuth(userToken),
    })
    expect(res.statusCode).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /usuarios/:id — Buscar por ID', () => {
  it('200 — retorna usuário existente', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(makeAluno())

    const res = await app.inject({
      method: 'GET',
      url: `/usuarios/${IDS.aluno}`,
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: IDS.aluno })
  })

  it('404 — usuário não existe', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'GET',
      url: '/usuarios/id-inexistente',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /usuarios/:id — Atualizar', () => {
  it('200 — atualiza campos do aluno', async () => {
    const before = makeAluno()
    const after = { ...makeAluno(), turma: '4SEM', semestreAtual: '4' }
    prismaMock.usuario.findUnique.mockResolvedValueOnce(before)
    prismaMock.usuario.update.mockResolvedValueOnce(after)

    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${IDS.aluno}`,
      headers: bearerAuth(adminToken),
      payload: { turma: '4SEM', semestreAtual: '4' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ turma: '4SEM' })
  })

  it('404 — usuário não encontrado no update', async () => {
    const err: any = new Error('Not found')
    err.code = 'P2025'
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)
    prismaMock.usuario.update.mockRejectedValueOnce(err)

    const res = await app.inject({
      method: 'PATCH',
      url: '/usuarios/ghost-id',
      headers: bearerAuth(adminToken),
      payload: { nome: 'Ghost' },
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /usuarios/:id — Soft Delete (Anonimização)', () => {
  it('200 — anonimiza e inativa o usuário', async () => {
    const before = makeAluno()
    const anonimizado = {
      ...makeAluno(),
      ativo: false,
      anonimizado: true,
      nome: 'Usuário Anônimo',
      ra: `anon_${IDS.aluno}`,
      emailPessoal: `anonp_${IDS.aluno}@anon.local`,
      emailEducacional: `anone_${IDS.aluno}@anon.edu.local`,
      deletadoEm: new Date(),
    }
    prismaMock.usuario.findUnique.mockResolvedValueOnce(before)
    prismaMock.usuario.update.mockResolvedValueOnce(anonimizado)

    const res = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${IDS.aluno}`,
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ anonimizado: true, ativo: false })
  })

  it('404 — usuário não existe para exclusão', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'DELETE',
      url: '/usuarios/ghost-id',
      headers: bearerAuth(adminToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it('401 — sem autenticação', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/usuarios/${IDS.aluno}` })
    expect(res.statusCode).toBe(401)
  })

  it('403 — papel não autorizado', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${IDS.aluno}`,
      headers: bearerAuth(userToken),
    })
    expect(res.statusCode).toBe(403)
  })
})
