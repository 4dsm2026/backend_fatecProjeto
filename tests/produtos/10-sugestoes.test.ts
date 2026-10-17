import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Sugestao } from '@prisma/client'
import { buildApp } from '../../src/app'
import { prismaMock } from '../../src/lib/__mocks__/prisma'
import { makeUserToken, bearerAuth } from '../helpers/auth'
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

let app: FastifyInstance
let userToken: string

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
  userToken = makeUserToken()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetMocks()
})

describe('POST /sugestoes — Caixa de Sugestões', () => {
  it('cria uma sugestão simples', async () => {
    const conteudo = 'Sugestão sem imagem'

    prismaMock.sugestao.create.mockResolvedValueOnce(
      criarSugestao(conteudo),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/sugestoes',
      headers: bearerAuth(userToken),
      payload: { conteudo, emailContato: EMAIL },
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: expect.any(String),
        emailContato: EMAIL,
        conteudo,
      },
    })
  })

  it('encaminha texto formatado e imagem para salvar no banco', async () => {
    const documento: SugestaoDocumento = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Texto em ',
              marks: [{ type: 'bold' }],
            },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'itálico',
              marks: [{ type: 'italic' }],
            },
          ],
        },
        {
          type: 'image',
          attrs: { src: IMAGEM_VALIDA, alt: 'print.png' },
        },
      ],
    }

    const conteudo = 'Texto em \nitálico'

    prismaMock.sugestao.create.mockResolvedValueOnce(
      criarSugestao(conteudo, documento),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/sugestoes',
      headers: bearerAuth(userToken),
      payload: { conteudo, emailContato: EMAIL, documento },
    })

    expect(res.statusCode).toBe(201)
    expect(extrairTextoDocumento(documento)).toBe(conteudo)
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: expect.any(String),
        emailContato: EMAIL,
        conteudo,
        documento,
      },
    })
  })

  it('aceita envio com três imagens e JSON maior que 1 MB', async () => {
    const conteudo = 'Teste com imagens'
    const documento = criarDocumento([
      criarImagemGrande(),
      IMAGEM_VALIDA,
      IMAGEM_VALIDA,
    ])

    const payload = JSON.stringify({
      conteudo,
      emailContato: EMAIL,
      documento,
    })

    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024)
    expect(Buffer.byteLength(payload)).toBeLessThan(10 * 1024 * 1024)

    prismaMock.sugestao.create.mockResolvedValueOnce(
      criarSugestao(conteudo, documento),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/sugestoes',
      headers: {
        ...bearerAuth(userToken),
        'content-type': 'application/json',
      },
      payload,
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.sugestao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: expect.any(String),
        emailContato: EMAIL,
        conteudo,
        documento,
      },
    })
  })

  it('rejeita quatro imagens sem salvar a sugestão', async () => {
    const documento = criarDocumento(
      Array.from({ length: 4 }, () => IMAGEM_VALIDA),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/sugestoes',
      headers: bearerAuth(userToken),
      payload: {
        conteudo: 'Teste com imagens',
        emailContato: EMAIL,
        documento,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(prismaMock.sugestao.create).not.toHaveBeenCalled()
  })

  it('rejeita uma URL de imagem fora dos formatos permitidos', () => {
    const documento = criarDocumento([
      'https://example.com/imagem.png',
    ])

    expect(
      SugestaoDocumentoSchema.safeParse(documento).success,
    ).toBe(false)
  })
})

describe('GET /sugestoes — listagem', () => {
  it('consulta apenas o resumo, sem carregar o documento com imagens', async () => {
    prismaMock.sugestao.count.mockResolvedValueOnce(0)
    prismaMock.sugestao.findMany.mockResolvedValueOnce([])

    const res = await app.inject({
      method: 'GET',
      url: '/sugestoes?page=1&pageSize=10',
      headers: bearerAuth(userToken),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    })

    expect(prismaMock.sugestao.findMany).toHaveBeenCalledWith({
      where: { usuarioId: expect.any(String) },
      orderBy: { criadoEm: 'desc' },
      skip: 0,
      take: 10,
      select: {
        id: true,
        conteudo: true,
        status: true,
        criadoEm: true,
        usuario: false,
      },
    })
  })
})