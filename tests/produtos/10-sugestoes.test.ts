import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Sugestao } from '@prisma/client'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeAdminToken, makeUserToken, bearerAuth } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'
import {
  SugestaoDocumentoSchema,
  extrairTextoDocumento,
  type SugestaoDocumento,
} from '../../src/validators/sugestao-documento'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({
  scheduleCleanupAnexos: vi.fn(),
}))

Object.assign(prismaMock.sugestao, {
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
})

let app: FastifyInstance
let userToken: string
let staffToken: string

const EMAIL = 'aluno@fatec.sp.gov.br'

const IMAGEM_VALIDA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function criarSugestao(
  conteudo: string,
  documento?: SugestaoDocumento,
): Sugestao {
  return {
    id: 'sug_teste',
    conteudo,
    documento: documento ?? null,
    usuarioId: 'usu_123',
    emailContato: EMAIL,
    status: 'NAO_RESPONDIDO',
    resposta: null,
    respostaDocumento: null,
    respondidoPorId: null,
    respondidoEm: null,
    criadoEm: new Date(),
  }
}

function criarDocumento(
  imagens: string[],
  texto = 'Teste com imagens',
): SugestaoDocumento {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: texto }],
      },
      ...imagens.map((src) => ({
        type: 'image' as const,
        attrs: { src, alt: 'Imagem de teste' },
      })),
    ],
  }
}

// GIF válido com comentários para aumentar o tamanho do arquivo.
// O objetivo é testar o transporte de um JSON maior que 1 MB.
function criarImagemGrande(): string {
  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  )

  const blocos: Buffer[] = [
    gif.subarray(0, gif.length - 1),
    Buffer.from([0x21, 0xfe]),
  ]

  let restante = 800 * 1024

  while (restante > 0) {
    const tamanho = Math.min(restante, 255)
    blocos.push(Buffer.from([tamanho]), Buffer.alloc(tamanho, 65))
    restante -= tamanho
  }

  blocos.push(Buffer.from([0x00, 0x3b]))

  return `data:image/gif;base64,${Buffer.concat(blocos).toString('base64')}`
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  // Usamos o UserToken porque é o Aluno que envia a sugestão
  userToken = makeUserToken()
  staffToken = makeAdminToken()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
})

describe('/suggestions — Caixa de Sugestões', () => {
  it('201 — cria uma nova sugestão com sucesso', async () => {
    const conteudo = 'Testando a urna direto pelo motor, sem navegador!'
    prismaMock.sugestao.create.mockResolvedValueOnce({
      ...criarSugestao(conteudo),
      id: 'sug_123',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/suggestions',
      headers: bearerAuth(userToken),
      payload: { conteudo, emailContato: EMAIL },
    })

    expect(res.statusCode).toBe(201)
    expect(res.headers.location).toBe('/suggestions/sug_123')
    expect(res.json()).toMatchObject({
      id: 'sug_123',
      _links: {
        self: { href: '/suggestions/sug_123', method: 'GET' },
        collection: { href: '/suggestions', method: 'GET' },
      },
    })
  })

  it('201 — encaminha texto formatado e imagem para salvar no banco', async () => {
    const documento: SugestaoDocumento = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Texto em ', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'itálico', marks: [{ type: 'italic' }] },
          ],
        },
        { type: 'image', attrs: { src: IMAGEM_VALIDA, alt: 'print.png' } },
      ],
    }
    const conteudo = 'Texto em \nitálico'

    prismaMock.sugestao.create.mockResolvedValueOnce(criarSugestao(conteudo, documento))

    const res = await app.inject({
      method: 'POST',
      url: '/suggestions',
      headers: bearerAuth(userToken),
      payload: { conteudo, emailContato: EMAIL, documento },
    })

    expect(res.statusCode).toBe(201)
    expect(extrairTextoDocumento(documento)).toBe(conteudo)
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith({
      data: { usuarioId: expect.any(String), emailContato: EMAIL, conteudo, documento },
    })
  })

  it('201 — aceita três imagens e JSON maior que 1 MB (bodyLimit da rota)', async () => {
    const conteudo = 'Teste com imagens'
    const documento = criarDocumento([criarImagemGrande(), IMAGEM_VALIDA, IMAGEM_VALIDA])
    const payload = JSON.stringify({ conteudo, emailContato: EMAIL, documento })

    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024)
    expect(Buffer.byteLength(payload)).toBeLessThan(10 * 1024 * 1024)

    prismaMock.sugestao.create.mockResolvedValueOnce(criarSugestao(conteudo, documento))

    const res = await app.inject({
      method: 'POST',
      url: '/suggestions',
      headers: { ...bearerAuth(userToken), 'content-type': 'application/json' },
      payload,
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith({
      data: { usuarioId: expect.any(String), emailContato: EMAIL, conteudo, documento },
    })
  })

  it('400 — rejeita quatro imagens sem salvar a sugestão', async () => {
    const documento = criarDocumento(Array.from({ length: 4 }, () => IMAGEM_VALIDA))

    const res = await app.inject({
      method: 'POST',
      url: '/suggestions',
      headers: bearerAuth(userToken),
      payload: { conteudo: 'Teste com imagens', emailContato: EMAIL, documento },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.sugestao.create).not.toHaveBeenCalled()
  })

  it('rejeita uma URL de imagem fora dos formatos permitidos', () => {
    const documento = criarDocumento(['https://example.com/imagem.png'])
    expect(SugestaoDocumentoSchema.safeParse(documento).success).toBe(false)
  })

  it('200 — lista as próprias sugestões como coleção HAL paginada', async () => {
    prismaMock.sugestao.count.mockResolvedValueOnce(1)
    prismaMock.sugestao.findMany.mockResolvedValueOnce([
      { ...criarSugestao('Ideia para o atendimento'), id: 'sug_123' },
    ])

    const res = await app.inject({
      method: 'GET',
      url: '/suggestions?page=0&size=10',
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      _embedded: {
        suggestions: [{
          id: 'sug_123',
          _links: {
            self: { href: '/suggestions/sug_123', method: 'GET' },
            collection: { href: '/suggestions', method: 'GET' },
          },
        }],
      },
      page: { size: 10, number: 0, totalElements: 1, totalPages: 1 },
      _links: { create: { href: '/suggestions', method: 'POST' } },
    })

    expect(prismaMock.sugestao.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId: expect.any(String) },
      skip: 0,
      take: 10,
    }))
  })

  it('200 — listagem consulta só o resumo, sem carregar documento com imagens', async () => {
    prismaMock.sugestao.count.mockResolvedValueOnce(0)
    prismaMock.sugestao.findMany.mockResolvedValueOnce([])

    const res = await app.inject({
      method: 'GET',
      url: '/suggestions?page=0&size=10',
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(200)

    const args = prismaMock.sugestao.findMany.mock.calls[0][0] as any
    expect(args.include).toBeUndefined()
    expect(args.select).toBeDefined()
    expect(args.select).not.toHaveProperty('documento')
    expect(args.select).not.toHaveProperty('respostaDocumento')
    // campos exigidos pelo schema HAL / links
    expect(args.select).toMatchObject({
      id: true, usuarioId: true, emailContato: true,
      conteudo: true, status: true, resposta: true,
    })
  })

  it('GET /:id — oferece resposta à equipe enquanto a sugestão está pendente', async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce({
      id: 'sug_123',
      conteudo: 'Ideia para o atendimento',
      usuarioId: 'usu_123',
      emailContato: 'aluno@fatec.sp.gov.br',
      status: 'NAO_RESPONDIDO',
      resposta: null,
      respondidoPorId: null,
      respondidoEm: null,
      criadoEm: new Date(),
      usuario: { id: 'usu_123', nome: 'Aluno', ra: '123' },
      respondidoPor: null,
    } as any)

    const res = await app.inject({
      method: 'GET',
      url: '/suggestions/sug_123',
      headers: bearerAuth(staffToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()._links.answer).toEqual({
      href: '/suggestions/sug_123',
      method: 'PATCH',
    })
  })

  it('GET /:id — esconde a resposta quando a sugestão já foi respondida', async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce({
      id: 'sug_123',
      conteudo: 'Ideia para o atendimento',
      usuarioId: 'usu_123',
      emailContato: 'aluno@fatec.sp.gov.br',
      status: 'RESPONDIDO',
      resposta: 'Vamos avaliar',
      respondidoPorId: 'staff_1',
      respondidoEm: new Date(),
      criadoEm: new Date(),
      usuario: { id: 'usu_123', nome: 'Aluno', ra: '123' },
      respondidoPor: { id: 'staff_1', nome: 'Equipe' },
    } as any)

    const res = await app.inject({
      method: 'GET',
      url: '/suggestions/sug_123',
      headers: bearerAuth(staffToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()._links).not.toHaveProperty('answer')
  })
})

describe('PATCH /suggestions/:id — responder sugestão', () => {
  const ID = 'sug_123'

  function pendente() {
    return { id: ID, status: 'NAO_RESPONDIDO', resposta: null }
  }

  function respondida(resposta: string, extra: Record<string, unknown> = {}) {
    return {
      ...criarSugestao('Ideia para o atendimento'),
      id: ID,
      status: 'RESPONDIDO' as const,
      resposta,
      respondidoPorId: 'admin-id-001',
      respondidoEm: new Date(),
      usuario: { id: 'usu_123', nome: 'Aluno', ra: '123' },
      respondidoPor: { id: 'admin-id-001', nome: 'Equipe' },
      ...extra,
    }
  }

  function patch(token: string | null, payload: unknown, raw = false) {
    return app.inject({
      method: 'PATCH',
      url: `/suggestions/${ID}`,
      headers: {
        ...(token ? bearerAuth(token) : {}),
        ...(raw ? { 'content-type': 'application/json' } : {}),
      },
      payload: payload as any,
    })
  }

  it('200 — equipe responde; grava RESPONDIDO e remove o link "answer"', async () => {
    prismaMock.sugestao.findUnique
      .mockResolvedValueOnce(pendente() as any)
      .mockResolvedValueOnce(respondida('Vamos avaliar') as any)
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await patch(staffToken, { resposta: 'Vamos avaliar' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: ID,
      status: 'RESPONDIDO',
      resposta: 'Vamos avaliar',
      _links: { self: { href: `/suggestions/${ID}`, method: 'GET' } },
    })
    expect(res.json()._links).not.toHaveProperty('answer')
    expect(prismaMock.sugestao.updateMany).toHaveBeenCalledWith({
      where: { id: ID, status: 'NAO_RESPONDIDO', resposta: null },
      data: expect.objectContaining({
        resposta: 'Vamos avaliar',
        status: 'RESPONDIDO',
        respondidoPorId: expect.any(String),
        respondidoEm: expect.any(Date),
      }),
    })
  })

  it('200 — salva a resposta formatada (respostaDocumento)', async () => {
    const respostaDocumento = criarDocumento([IMAGEM_VALIDA], 'Resposta formatada')
    prismaMock.sugestao.findUnique
      .mockResolvedValueOnce(pendente() as any)
      .mockResolvedValueOnce(respondida('Resposta formatada', { respostaDocumento }) as any)
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await patch(staffToken, { resposta: 'Resposta formatada', respostaDocumento })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.sugestao.updateMany).toHaveBeenCalledWith({
      where: expect.anything(),
      data: expect.objectContaining({ resposta: 'Resposta formatada', respostaDocumento }),
    })
  })

  it('200 — aceita resposta com imagem grande (JSON > 1 MB, bodyLimit do PATCH)', async () => {
    const respostaDocumento = criarDocumento([criarImagemGrande()], 'Resposta com imagem')
    const payload = JSON.stringify({ resposta: 'Resposta com imagem', respostaDocumento })
    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024)

    prismaMock.sugestao.findUnique
      .mockResolvedValueOnce(pendente() as any)
      .mockResolvedValueOnce(respondida('Resposta com imagem', { respostaDocumento }) as any)
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await patch(staffToken, payload, true)

    expect(res.statusCode).toBe(200)
  })

  it('200 — ignora "status" enviado no corpo: o service sempre grava RESPONDIDO', async () => {
    prismaMock.sugestao.findUnique
      .mockResolvedValueOnce(pendente() as any)
      .mockResolvedValueOnce(respondida('Ok') as any)
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await patch(staffToken, { resposta: 'Ok', status: 'NAO_RESPONDIDO' })

    expect(res.statusCode).toBe(200)
    expect(prismaMock.sugestao.updateMany).toHaveBeenCalledWith({
      where: expect.anything(),
      data: expect.objectContaining({ status: 'RESPONDIDO' }),
    })
  })

  it('401 — sem token', async () => {
    const res = await patch(null, { resposta: 'Ok' })

    expect(res.statusCode).toBe(401)
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled()
  })

  it('403 — aluno não pode responder', async () => {
    const res = await patch(userToken, { resposta: 'Ok' })

    expect(res.statusCode).toBe(403)
    expect(prismaMock.sugestao.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['sem o campo resposta', {}],
    ['resposta vazia', { resposta: '' }],
    ['resposta só com espaços', { resposta: '   ' }],
    ['resposta acima de 1000 caracteres', { resposta: 'a'.repeat(1001) }],
    ['respostaDocumento sem texto', { resposta: 'Ok', respostaDocumento: { type: 'doc', content: [] } }],
  ])('400 — %s', async (_nome, payload) => {
    const res = await patch(staffToken, payload)

    expect(res.statusCode).toBe(400)
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled()
  })

  it('404 — sugestão inexistente', async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce(null)

    const res = await patch(staffToken, { resposta: 'Ok' })

    expect(res.statusCode).toBe(404)
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled()
  })

  it('409 — sugestão já respondida não pode ser alterada', async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce({
      id: ID,
      status: 'RESPONDIDO',
      resposta: 'Resposta antiga',
    } as any)

    const res = await patch(staffToken, { resposta: 'Nova resposta' })

    expect(res.statusCode).toBe(409)
    expect(prismaMock.sugestao.updateMany).not.toHaveBeenCalled()
  })

  it('409 — corrida: outra pessoa respondeu entre a leitura e a gravação', async () => {
    prismaMock.sugestao.findUnique.mockResolvedValueOnce(pendente() as any)
    prismaMock.sugestao.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await patch(staffToken, { resposta: 'Ok' })

    expect(res.statusCode).toBe(409)
  })
})
