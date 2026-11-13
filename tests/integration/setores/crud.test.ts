import type { Papel, PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createSetor, vincularUsuarioAoSetor } from '../_helpers/setores'
import type {
  HalCollection,
  ProblemDetails,
  SectorDetailResource,
  SectorResource,
} from '../_setup/contracts'
import { createTestApp } from '../_setup/createTestApp'

const PASSWORD = 'Fixture-only-A1!23456789'

async function withDatabase(run: (prisma: PrismaClient, baseUrl: string) => Promise<void>) {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
  try {
    await run(prisma, (await createTestApp()).baseUrl)
  } finally {
    await prisma.$disconnect()
  }
}

async function actor(prisma: PrismaClient, baseUrl: string, role: Papel, label: string) {
  const { hash } = await import('argon2')
  const email = `${label}@example.test`
  const user = await prisma.usuario.create({
    data: { nome: label, emailPessoal: email, senhaHash: await hash(PASSWORD), papel: role },
  })
  const response = await fetch(new URL('/sessions', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  expect(response.status).toBe(201)
  return { user, session: (await response.json()) as { accessToken: string } }
}

function request(baseUrl: string, token: string, path: string, method = 'GET', body?: object) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('Integração HTTP: setores (/admin/sectors)', () => {
  it('helper createSetor retorna 201, Location, resposta clonada e persiste no banco', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-helper-admin')
      const created = await createSetor(
        { baseUrl },
        session,
        { nome: 'Secretaria fixture', descricao: 'Atendimento geral' },
      )

      expect(created.response.status).toBe(201)
      expect(created.response.headers.get('location')).toBe(`/admin/sectors/${created.resource.id}`)
      expect(((await created.response.json()) as { id: string }).id).toBe(created.resource.id)
      expect(created.resource._links.self.href).toBe(`/admin/sectors/${created.resource.id}`)
      expect(await db.setor.count({ where: { id: created.resource.id } })).toBe(1)
    }))

  it('executa ciclo CRUD completo com detalhe HAL, contagens _count e exclusão 204', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-crud-admin')
      const org = await db.organizacao.create({ data: { nome: 'Fatec CRUD', sigla: 'FATEC' } })
      const created = await createSetor(
        { baseUrl },
        session,
        { nome: 'Protocolo Central', descricao: 'Recepção de pedidos', organizacaoId: org.id },
      )

      expect(created.resource._links).toMatchObject({
        self: { href: `/admin/sectors/${created.resource.id}`, method: 'GET' },
        collection: { href: '/admin/sectors', method: 'GET' },
        update: { href: `/admin/sectors/${created.resource.id}`, method: 'PATCH' },
        delete: { href: `/admin/sectors/${created.resource.id}`, method: 'DELETE' },
        users: { href: `/admin/sectors/${created.resource.id}/users`, method: 'GET' },
      })

      const detailRes = await request(baseUrl, session.accessToken, `/admin/sectors/${created.resource.id}`)
      expect(detailRes.status).toBe(200)
      const detail = (await detailRes.json()) as SectorDetailResource
      expect(detail).toMatchObject({
        id: created.resource.id,
        nome: 'Protocolo Central',
        descricao: 'Recepção de pedidos',
        organizacaoId: org.id,
        _count: { usuarioSetores: 0, chamados: 0 },
      })

      await vincularUsuarioAoSetor({ baseUrl }, session, { usuarioId: user.id, setorId: created.resource.id })
      await db.chamado.create({
        data: {
          titulo: 'Chamado no setor',
          descricao: 'Contagem de vínculo e chamado',
          setorId: created.resource.id,
          criadoPorId: user.id,
        },
      })

      const countsRes = await request(baseUrl, session.accessToken, `/admin/sectors/${created.resource.id}`)
      expect(countsRes.status).toBe(200)
      expect(((await countsRes.json()) as SectorDetailResource)._count).toEqual({ usuarioSetores: 1, chamados: 1 })

      const patchRes = await request(baseUrl, session.accessToken, `/admin/sectors/${created.resource.id}`, 'PATCH', {
        nome: 'Protocolo Atualizado',
        descricao: null,
      })
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toMatchObject({
        id: created.resource.id,
        nome: 'Protocolo Atualizado',
        descricao: null,
      })

      await db.chamado.deleteMany({ where: { setorId: created.resource.id } })

      const deleteRes = await request(baseUrl, session.accessToken, `/admin/sectors/${created.resource.id}`, 'DELETE')
      expect(deleteRes.status).toBe(204)
      expect(await deleteRes.text()).toBe('')

      const afterDelete = await request(baseUrl, session.accessToken, `/admin/sectors/${created.resource.id}`)
      expect(afterDelete.status).toBe(404)
      expect(afterDelete.headers.get('content-type')).toContain('application/problem+json')
      expect(await db.setor.count({ where: { id: created.resource.id } })).toBe(0)
    }))

  it('lista setores em ordem alfabética com paginação HAL e filtros preservados nos links', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-list-admin')
      const orgA = await db.organizacao.create({ data: { nome: 'Org A' } })
      const orgB = await db.organizacao.create({ data: { nome: 'Org B' } })

      const gamma = await createSetor({ baseUrl }, session, { nome: 'Gamma Setor', organizacaoId: orgA.id })
      const alpha = await createSetor({ baseUrl }, session, { nome: 'Alpha Setor', organizacaoId: orgA.id })
      const beta = await createSetor({ baseUrl }, session, { nome: 'Beta Setor', organizacaoId: orgA.id })
      await createSetor({ baseUrl }, session, { nome: 'Delta Setor', organizacaoId: orgB.id })
      await createSetor({ baseUrl }, session, { nome: 'Outro Nome', organizacaoId: orgA.id })

      const query = `page=0&size=1&search=Setor&organizacaoId=${encodeURIComponent(orgA.id)}`
      const page0Res = await request(baseUrl, session.accessToken, `/admin/sectors?${query}`)
      expect(page0Res.status).toBe(200)
      const page0 = (await page0Res.json()) as HalCollection<SectorResource, 'sectors'>

      expect(page0.page).toEqual({ size: 1, number: 0, totalElements: 3, totalPages: 3 })
      expect(page0._embedded.sectors.map(s => s.id)).toEqual([alpha.resource.id])
      expect(page0._links.create).toEqual({ href: '/admin/sectors', method: 'POST' })
      expect(page0._links.prev).toBeUndefined()
      expect(page0._links.next).toBeDefined()

      const nextLink = page0._links.next as { href: string }
      expect(nextLink.href).toContain('search=Setor')
      expect(nextLink.href).toContain(`organizacaoId=${orgA.id}`)

      const page1Res = await request(baseUrl, session.accessToken, nextLink.href)
      expect(page1Res.status).toBe(200)
      const page1 = (await page1Res.json()) as HalCollection<SectorResource, 'sectors'>
      expect(page1.page).toEqual({ size: 1, number: 1, totalElements: 3, totalPages: 3 })
      expect(page1._embedded.sectors.map(s => s.id)).toEqual([beta.resource.id])
      expect(page1._links.prev).toBeDefined()
      expect(page1._links.next).toBeDefined()

      const lastLink = page1._links.last as { href: string }
      const page2Res = await request(baseUrl, session.accessToken, lastLink.href)
      expect(page2Res.status).toBe(200)
      const page2 = (await page2Res.json()) as HalCollection<SectorResource, 'sectors'>
      expect(page2.page).toEqual({ size: 1, number: 2, totalElements: 3, totalPages: 3 })
      expect(page2._embedded.sectors.map(s => s.id)).toEqual([gamma.resource.id])
      expect(page2._links.prev).toBeDefined()
      expect(page2._links.next).toBeUndefined()
    }))

  it('retorna 400 e 404 em formato RFC 7807 para validações e recursos inexistentes', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-errors-admin')
      const created = await createSetor({ baseUrl }, session, { nome: 'Setor Válido' })

      const invalidCreate = await request(baseUrl, session.accessToken, '/admin/sectors', 'POST', { nome: 'A' })
      expect(invalidCreate.status).toBe(400)
      expect(invalidCreate.headers.get('content-type')).toContain('application/problem+json')
      const createProblem = (await invalidCreate.json()) as ProblemDetails
      expect(createProblem.status).toBe(400)
      expect(createProblem.errors?.length).toBeGreaterThan(0)

      const invalidPatch = await request(
        baseUrl,
        session.accessToken,
        `/admin/sectors/${created.resource.id}`,
        'PATCH',
        { nome: 'X' },
      )
      expect(invalidPatch.status).toBe(400)
      expect(invalidPatch.headers.get('content-type')).toContain('application/problem+json')

      const invalidQuery = await request(baseUrl, session.accessToken, '/admin/sectors?size=101')
      expect(invalidQuery.status).toBe(400)
      expect(invalidQuery.headers.get('content-type')).toContain('application/problem+json')

      for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
        const res = await request(
          baseUrl,
          session.accessToken,
          '/admin/sectors/setor-inexistente',
          method,
          method === 'PATCH' ? { nome: 'Novo' } : undefined,
        )
        expect(res.status, `${method} inexistente`).toBe(404)
        expect(res.headers.get('content-type')).toContain('application/problem+json')
        const problem = (await res.json()) as ProblemDetails
        expect(problem.type).toBe('/errors/not-found')
        expect(problem.status).toBe(404)
      }
    }))

  it('exige autenticação (401) e restringe rotas de setores apenas a ADMINISTRADOR (403)', async () =>
    withDatabase(async (db, baseUrl) => {
      const admin = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-matrix-admin')
      const baseSector = await createSetor({ baseUrl }, admin.session, { nome: 'Setor Protegido' })

      const anonymousCalls: Array<[string, string, object?]> = [
        ['/admin/sectors', 'GET'],
        ['/admin/sectors', 'POST', { nome: 'Sem Auth' }],
        [`/admin/sectors/${baseSector.resource.id}`, 'GET'],
        [`/admin/sectors/${baseSector.resource.id}`, 'PATCH', { nome: 'Sem Auth' }],
        [`/admin/sectors/${baseSector.resource.id}`, 'DELETE'],
      ]
      for (const [path, method, body] of anonymousCalls) {
        const res = await fetch(new URL(path, baseUrl), {
          method,
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })
        expect(res.status, `anon ${method} ${path}`).toBe(401)
      }

      for (const role of ['ADMINISTRADOR', 'TECNICO', 'BACKOFFICE', 'USUARIO'] as const) {
        const current =
          role === 'ADMINISTRADOR'
            ? admin
            : await actor(db, baseUrl, role, `sector-matrix-${role.toLowerCase()}`)
        const target = await createSetor({ baseUrl }, admin.session, { nome: `Setor Matriz ${role}` })
        const allowed = role === 'ADMINISTRADOR'

        const createRes = await request(baseUrl, current.session.accessToken, '/admin/sectors', 'POST', {
          nome: `Criado por ${role}`,
        })
        expect(createRes.status, `${role} POST /admin/sectors`).toBe(allowed ? 201 : 403)

        for (const [path, method, body, success] of [
          ['/admin/sectors', 'GET', undefined, 200],
          [`/admin/sectors/${target.resource.id}`, 'GET', undefined, 200],
          [`/admin/sectors/${target.resource.id}`, 'PATCH', { nome: `Alterado ${role}` }, 200],
          [`/admin/sectors/${target.resource.id}`, 'DELETE', undefined, 204],
        ] as Array<[string, string, object | undefined, number]>) {
          const res = await request(baseUrl, current.session.accessToken, path, method, body)
          expect(res.status, `${role} ${method} ${path}`).toBe(allowed ? success : 403)
          if (!allowed) {
            expect(res.headers.get('content-type')).toContain('application/problem+json')
          }
        }
        expect(await db.setor.count({ where: { id: target.resource.id } })).toBe(allowed ? 0 : 1)
      }
    }))

  it('ao excluir setor remove vínculos em cascata, preserva usuários e não deixa órfãos', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sector-cascade-admin')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor Exclusão Cascata' })
      const binding = await vincularUsuarioAoSetor({ baseUrl }, session, {
        usuarioId: user.id,
        setorId: sector.resource.id,
      })

      const response = await request(baseUrl, session.accessToken, `/admin/sectors/${sector.resource.id}`, 'DELETE')
      expect(response.status).toBe(204)
      expect(await db.setor.count({ where: { id: sector.resource.id } })).toBe(0)
      expect(await db.usuarioSetor.count({ where: { id: binding.resource.id } })).toBe(0)
      expect(await db.usuario.count({ where: { id: user.id } })).toBe(1)
    }))
})
