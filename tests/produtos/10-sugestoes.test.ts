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
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

Object.assign(prismaMock.sugestao, {
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
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
    // PREPARAR (Arrange): Criamos uma sugestão falsa contendo o emailContato obrigatório
    const novaSugestaoFalsa = {
      id: 'sug_123',
      conteudo: 'Testando a urna direto pelo motor, sem navegador!',
      usuarioId: 'usu_123',
      emailContato: 'aluno@fatec.sp.gov.br',
      status: 'NAO_RESPONDIDO',
      resposta: null,
      respondidoPorId: null,
      respondidoEm: null,
      criadoEm: new Date()
    }
    
    prismaMock.sugestao.create.mockResolvedValueOnce(novaSugestaoFalsa as any) 

    // AGIR (Act): O Fastify atira os dados contra a rota enviando o e-mail no payload
    const res = await app.inject({
      method: 'POST',
      url: '/suggestions',
      headers: bearerAuth(userToken), 
      payload: {
        conteudo: 'Testando a urna direto pelo motor, sem navegador!',
        emailContato: 'aluno@fatec.sp.gov.br'
      },
    })

    // VERIFICAR (Assert): Conferimos se o motor respondeu com sucesso e devolveu o ID
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

  it('200 — lista as próprias sugestões como coleção HAL paginada', async () => {
    prismaMock.sugestao.count.mockResolvedValueOnce(1)
    prismaMock.sugestao.findMany.mockResolvedValueOnce([{
      id: 'sug_123',
      conteudo: 'Ideia para o atendimento',
      usuarioId: 'usu_123',
      emailContato: 'aluno@fatec.sp.gov.br',
      status: 'NAO_RESPONDIDO',
      resposta: null,
      respondidoPorId: null,
      respondidoEm: null,
      criadoEm: new Date(),
    }] as any)

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
      _links: {
        create: { href: '/suggestions', method: 'POST' },
      },
    })

    expect(prismaMock.sugestao.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId: expect.any(String) },
      skip: 0,
      take: 10,
    }))
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