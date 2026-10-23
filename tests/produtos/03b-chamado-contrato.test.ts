/**
 * Produto: Chamados — teste de contrato dos links (HATEOAS)
 *
 * Regra do módulo: o link está presente se, e somente se, a ação é permitida.
 *   (→) todo link devolvido, ao ser seguido (href + method), funciona: 200;
 *   (←) toda ação SEM link é recusada pelo PATCH: 403 ou 409.
 *
 * Varre todos os papéis contra todos os estados do chamado, arquivado ou não.
 * Só cobra os links do próprio módulo `tickets`; `messages`, `attachments`,
 * `reply` e `upload` apontam para módulos que ainda serão convertidos.
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
import { makeUserToken, bearerAuth } from '../helpers/auth'
import type { TestRole } from '../helpers/auth'
import { resetMocks } from '../helpers/reset'

type Link = { href: string; method: string; name?: string }
type Status = 'ABERTO' | 'EM_ATENDIMENTO' | 'AGUARDANDO_USUARIO' | 'RESOLVIDO' | 'ENCERRADO'
type Estado = { estado: string; status: Status; encerradoHaDias: number | null }
type Cenario = Estado & { papel: TestRole; arquivado: boolean }

const DIA_MS = 24 * 60 * 60 * 1000

const PAPEIS: TestRole[] = ['USUARIO', 'TECNICO', 'BACKOFFICE', 'ADMINISTRADOR']

const STATUS: Status[] = ['ABERTO', 'EM_ATENDIMENTO', 'AGUARDANDO_USUARIO', 'RESOLVIDO', 'ENCERRADO']

const ABERTO: Estado = { estado: 'ABERTO', status: 'ABERTO', encerradoHaDias: null }

const ESTADOS: Estado[] = [
  ABERTO,
  { estado: 'EM_ATENDIMENTO', status: 'EM_ATENDIMENTO', encerradoHaDias: null },
  { estado: 'AGUARDANDO_USUARIO', status: 'AGUARDANDO_USUARIO', encerradoHaDias: null },
  { estado: 'RESOLVIDO há 1 dia', status: 'RESOLVIDO', encerradoHaDias: 1 },
  { estado: 'RESOLVIDO há 31 dias', status: 'RESOLVIDO', encerradoHaDias: 31 },
  { estado: 'ENCERRADO há 1 dia', status: 'ENCERRADO', encerradoHaDias: 1 },
  { estado: 'ENCERRADO há 31 dias', status: 'ENCERRADO', encerradoHaDias: 31 },
]

// Links do módulo `tickets` (os demais pertencem a módulos ainda não convertidos).
const RELS_DO_MODULO = ['self', 'collection', 'update', 'transition', 'reopen', 'archive', 'unarchive']

const CENARIOS: Cenario[] = PAPEIS.flatMap((papel) =>
  ESTADOS.flatMap((estado) => [false, true].map((arquivado) => ({ ...estado, papel, arquivado }))),
)

let app: FastifyInstance
const tokens = {} as Record<TestRole, string>

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  for (const papel of PAPEIS) {
    // O aluno é o dono do chamado (IDS.user); a equipe é outra pessoa.
    const sub = papel === 'USUARIO' ? 'user-id-001' : `${papel.toLowerCase()}-id-001`
    tokens[papel] = makeUserToken({ sub, role: papel })
  }
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

// ── helpers ─────────────────────────────────────────────────────────────────

function lista(valor: Link | Link[] | undefined): Link[] {
  if (!valor) return []
  return Array.isArray(valor) ? valor : [valor]
}

function prepararChamado(c: Cenario) {
  const encerradoEm = c.encerradoHaDias === null ? null : new Date(Date.now() - c.encerradoHaDias * DIA_MS)
  const ticket = makeTicket({
    status: c.status,
    encerradoEm,
    arquivadoEm: c.arquivado ? new Date() : null,
  })
  prismaMock.chamado.findFirst.mockResolvedValue(ticket)
  prismaMock.chamado.update.mockResolvedValue(ticket)
  prismaMock.chamado.count.mockResolvedValue(0)
  prismaMock.chamado.findMany.mockResolvedValue([])
  return ticket
}

/** O corpo que cada tipo de link espera no PATCH. */
function corpoDoLink(rel: string, link: Link): object | undefined {
  switch (rel) {
    case 'transition':
    case 'reopen':
      return { status: link.name }
    case 'update':
      return { titulo: 'Título atualizado pelo teste de contrato' }
    case 'archive':
      return { arquivado: true }
    case 'unarchive':
      return { arquivado: false }
    default:
      return undefined
  }
}

const seguir = (token: string, link: Link, payload?: object) =>
  app.inject({
    method: link.method as 'GET' | 'PATCH',
    url: link.href,
    headers: bearerAuth(token),
    payload,
  })

const patch = (token: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/tickets/${IDS.ticket}`, headers: bearerAuth(token), payload })

// ── o contrato ──────────────────────────────────────────────────────────────

describe('Contrato dos links do chamado: link presente ⇔ ação permitida', () => {
  it.each(CENARIOS)('$papel · $estado · arquivado=$arquivado', async (c) => {
    prepararChamado(c)
    const token = tokens[c.papel]
    const onde = `${c.papel} em ${c.estado}${c.arquivado ? ' (arquivado)' : ''}`

    const detalhe = await app.inject({ method: 'GET', url: `/tickets/${IDS.ticket}`, headers: bearerAuth(token) })
    expect(detalhe.statusCode, `${onde}: o detalhe deveria abrir`).toBe(200)
    const links = detalhe.json()._links as Record<string, Link | Link[]>
    expect(lista(links.self), `${onde}: todo recurso tem self`).toHaveLength(1)

    // (→) todo link devolvido funciona
    for (const rel of RELS_DO_MODULO) {
      for (const link of lista(links[rel])) {
        const res = await seguir(token, link, corpoDoLink(rel, link))
        expect(res.statusCode, `${onde}: o link "${rel}" ${link.name ?? ''} veio, mas não funcionou`).toBe(200)
      }
    }

    // (←) ação sem link é recusada
    const statusComLink = new Set([...lista(links.transition), ...lista(links.reopen)].map((l) => l.name))
    for (const status of STATUS) {
      if (status === c.status || statusComLink.has(status)) continue
      const res = await patch(token, { status })
      expect([403, 409], `${onde}: mudar para ${status} não tem link, mas o PATCH aceitou`).toContain(res.statusCode)
    }

    const semLink: Array<[string, object]> = [
      ['update', { titulo: 'Título atualizado pelo teste de contrato' }],
      ['archive', { arquivado: true }],
      ['unarchive', { arquivado: false }],
    ]
    for (const [rel, corpo] of semLink) {
      if (lista(links[rel]).length > 0) continue
      const res = await patch(token, corpo)
      expect([403, 409], `${onde}: "${rel}" não tem link, mas o PATCH aceitou`).toContain(res.statusCode)
    }
  })

  it('aluno que não é o dono não vê o chamado nem consegue alterá-lo (404)', async () => {
    prepararChamado({ ...ABERTO, papel: 'USUARIO', arquivado: false })
    const intruso = makeUserToken({ sub: 'outro-aluno-id', role: 'USUARIO' })

    const detalhe = await app.inject({ method: 'GET', url: `/tickets/${IDS.ticket}`, headers: bearerAuth(intruso) })
    const alterar = await patch(intruso, { status: 'ENCERRADO' })

    expect(detalhe.statusCode).toBe(404)
    expect(alterar.statusCode).toBe(404)
  })

  it('âncora: o administrador em chamado ABERTO tem update, transition e archive', async () => {
    prepararChamado({ ...ABERTO, papel: 'ADMINISTRADOR', arquivado: false })

    const detalhe = await app.inject({
      method: 'GET',
      url: `/tickets/${IDS.ticket}`,
      headers: bearerAuth(tokens.ADMINISTRADOR),
    })
    const links = detalhe.json()._links as Record<string, Link | Link[]>

    expect(lista(links.update)).toHaveLength(1)
    expect(lista(links.transition).length).toBeGreaterThan(0)
    expect(lista(links.archive)).toHaveLength(1)
    expect(lista(links.unarchive)).toHaveLength(0)
  })
})