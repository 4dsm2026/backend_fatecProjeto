/**
 * Rede de segurança: todo link que o `GET /api` entrega precisa apontar para uma rota que existe.
 * Pega o caso "link novo, rota antiga" (ex.: link `/users` com a rota ainda registrada em `/usuarios`),
 * que o cliente e o futuro teste de contrato (Testcontainers) enxergariam como 404.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

import type { FastifyInstance, HTTPMethods } from 'fastify'
import { buildApp } from '../../src/app'
import { entryLinks } from '../../src/hateoas'
import type { Role } from '../../src/hateoas'

/**
 * PENDÊNCIAS CONHECIDAS (P.2b): o link já usa o nome novo, mas o prefixo no `app.ts` ainda é o antigo.
 * Ao renomear o prefixo, REMOVA a linha daqui: o segundo teste falha de propósito para lembrar disso.
 */
const KNOWN_BROKEN = new Set<string>([
  'GET /users', //       app.ts ainda registra usersRoutes em "/usuarios"
  'GET /catalog', //     app.ts ainda registra catalogoRoutes em "/catalogo"
  'GET /suggestions', // app.ts ainda registra sugestoesRoutes em "/sugestoes"
])

const ROLES: Role[] = ['USUARIO', 'BACKOFFICE', 'TECNICO', 'ADMINISTRADOR']

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

/** Todos os links de entrada de todos os papéis, sem repetir (método + href). */
function entryTargets() {
  const targets = new Map<string, { method: HTTPMethods; href: string; rels: Set<string> }>()
  for (const role of ROLES) {
    for (const [rel, l] of Object.entries(entryLinks({ id: 'u1', role }))) {
      const method = (l.method ?? 'GET') as HTTPMethods
      const key = `${method} ${l.href}`
      const entry = targets.get(key) ?? { method, href: l.href, rels: new Set<string>() }
      entry.rels.add(rel)
      targets.set(key, entry)
    }
  }
  return targets
}

describe('GET /api: alcance dos links de entrada', () => {
  it('todo link aponta para uma rota registrada (fora as pendências conhecidas)', () => {
    const quebrados = [...entryTargets().entries()]
      .filter(([key]) => !KNOWN_BROKEN.has(key))
      .filter(([, t]) => !app.hasRoute({ method: t.method, url: t.href }))
      .map(([key, t]) => `${key} (rel: ${[...t.rels].join(', ')})`)

    expect(quebrados, 'links de entrada sem rota registrada').toEqual([])
  })

  it('as pendências conhecidas continuam pendentes (se isto falhar, tire a linha de KNOWN_BROKEN)', () => {
    const jaCorrigidos = [...KNOWN_BROKEN].filter((key) => {
      const t = entryTargets().get(key)
      return t ? app.hasRoute({ method: t.method, url: t.href }) : true
    })

    expect(jaCorrigidos, 'já funcionam (ou saíram do entryLinks): remova de KNOWN_BROKEN').toEqual([])
  })
})
