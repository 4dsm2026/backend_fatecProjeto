/**
 * Rede de segurança: todo link que o `GET /api` entrega precisa apontar para uma rota que existe.
 * Pega links de entrada sem uma rota correspondente, que seriam 404 para clientes.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

import type { FastifyInstance, HTTPMethods } from 'fastify'
import { buildApp } from '../../src/app'
import { entryLinks } from '../../src/hateoas'
import type { Role } from '../../src/hateoas'

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
  it('todo link aponta para uma rota registrada', () => {
    const quebrados = [...entryTargets().entries()]
      .filter(([, t]) => !app.hasRoute({ method: t.method, url: t.href }))
      .map(([key, t]) => `${key} (rel: ${[...t.rels].join(', ')})`)

    expect(quebrados, 'links de entrada sem rota registrada').toEqual([])
  })
})
