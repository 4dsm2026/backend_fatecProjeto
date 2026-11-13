import type { Papel, PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createSetor, vincularUsuarioAoSetor } from '../_helpers/setores'
import type {
  HalCollection,
  ProblemDetails,
  SectorMemberResource,
  UserSectorResource,
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

async function actor(
  prisma: PrismaClient,
  baseUrl: string,
  role: Papel,
  label: string,
  extra?: { nome?: string; ra?: string },
) {
  const { hash } = await import('argon2')
  const email = `${label}@example.test`
  const user = await prisma.usuario.create({
    data: {
      nome: extra?.nome ?? label,
      emailPessoal: email,
      ra: extra?.ra ?? null,
      senhaHash: await hash(PASSWORD),
      papel: role,
    },
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

describe('Integração HTTP: vínculos usuário↔setor', () => {
  it('helper vincularUsuarioAoSetor retorna 201, Location, resposta clonada e links HAL', async () =>
    withDatabase(async (db, baseUrl) => {
      const admin = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-helper-admin')
      const member = await actor(db, baseUrl, 'TECNICO', 'binding-helper-member')
      const sector = await createSetor({ baseUrl }, admin.session, { nome: 'Secretaria Vínculo' })

      const binding = await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
        usuarioId: member.user.id,
        setorId: sector.resource.id,
      })

      expect(binding.response.status).toBe(201)
      expect(binding.response.headers.get('location')).toBe(`/admin/user-sectors/${binding.resource.id}`)
      expect(((await binding.response.json()) as { id: string }).id).toBe(binding.resource.id)
      expect(binding.resource).toMatchObject({
        usuarioId: member.user.id,
        setorId: sector.resource.id,
        papelId: null,
      })
      expect(binding.resource.id).not.toBe(member.user.id)
      expect(binding.resource.id).not.toBe(sector.resource.id)
      expect(binding.resource._links).toMatchObject({
        self: { href: `/admin/user-sectors/${binding.resource.id}`, method: 'GET' },
        update: { href: `/admin/user-sectors/${binding.resource.id}`, method: 'PATCH' },
        delete: { href: `/admin/user-sectors/${binding.resource.id}`, method: 'DELETE' },
        user: { href: `/users/${member.user.id}`, method: 'GET' },
        sector: { href: `/admin/sectors/${sector.resource.id}`, method: 'GET' },
      })
      expect(
        await db.usuarioSetor.count({
          where: { id: binding.resource.id, usuarioId: member.user.id, setorId: sector.resource.id },
        }),
      ).toBe(1)
    }))

  it('lista vínculos por setor e por usuário com paginação HAL e filtro search preservado', async () =>
    withDatabase(async (db, baseUrl) => {
      const admin = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-list-admin')
      const m1 = await actor(db, baseUrl, 'TECNICO', 'binding-list-1', { nome: 'Alice Atendimento' })
      const m2 = await actor(db, baseUrl, 'TECNICO', 'binding-list-2', { nome: 'Bruno Atendimento' })
      const m3 = await actor(db, baseUrl, 'BACKOFFICE', 'binding-list-3', { nome: 'Carlos Outro' })
      const s1 = await createSetor({ baseUrl }, admin.session, { nome: 'Setor Lista 1' })
      const s2 = await createSetor({ baseUrl }, admin.session, { nome: 'Setor Lista 2' })

      const b1 = await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
        usuarioId: m1.user.id,
        setorId: s1.resource.id,
        papelId: 'integration-reference-role',
      })
      const b2 = await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
        usuarioId: m2.user.id,
        setorId: s1.resource.id,
      })
      await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
        usuarioId: m3.user.id,
        setorId: s1.resource.id,
      })
      const b1Other = await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
        usuarioId: m1.user.id,
        setorId: s2.resource.id,
      })

      const page0Res = await request(
        baseUrl,
        admin.session.accessToken,
        `/admin/sectors/${s1.resource.id}/users?page=0&size=1&search=Atendimento`,
      )
      expect(page0Res.status).toBe(200)
      const page0 = (await page0Res.json()) as HalCollection<SectorMemberResource, 'users'>
      expect(page0.page).toEqual({ size: 1, number: 0, totalElements: 2, totalPages: 2 })
      expect(page0._embedded.users).toHaveLength(1)
      expect(page0._links.next).toBeDefined()
      expect((page0._links.next as { href: string }).href).toContain('search=Atendimento')

      const page1Res = await request(baseUrl, admin.session.accessToken, (page0._links.next as { href: string }).href)
      expect(page1Res.status).toBe(200)
      const page1 = (await page1Res.json()) as HalCollection<SectorMemberResource, 'users'>
      expect(page1.page).toEqual({ size: 1, number: 1, totalElements: 2, totalPages: 2 })
      expect(page1._links.next).toBeUndefined()

      const combined = [...page0._embedded.users, ...page1._embedded.users]
      expect(combined.map(u => u.id).sort()).toEqual([b1.resource.id, b2.resource.id].sort())
      const withRole = combined.find(u => u.id === b1.resource.id)!
      expect(withRole.usuario).toMatchObject({ id: m1.user.id, nome: 'Alice Atendimento' })
      expect(withRole.papel).toMatchObject({ id: 'integration-reference-role', nome: 'Referência de teste' })

      const userSectors0Res = await request(
        baseUrl,
        admin.session.accessToken,
        `/admin/users/${m1.user.id}/sectors?page=0&size=1`,
      )
      expect(userSectors0Res.status).toBe(200)
      const userSectors0 = (await userSectors0Res.json()) as HalCollection<UserSectorResource, 'sectors'>
      expect(userSectors0.page).toEqual({ size: 1, number: 0, totalElements: 2, totalPages: 2 })
      expect(userSectors0._links.next).toBeDefined()

      const userSectors1Res = await request(
        baseUrl,
        admin.session.accessToken,
        (userSectors0._links.next as { href: string }).href,
      )
      expect(userSectors1Res.status).toBe(200)
      const userSectors1 = (await userSectors1Res.json()) as HalCollection<UserSectorResource, 'sectors'>
      const allUserBindings = [...userSectors0._embedded.sectors, ...userSectors1._embedded.sectors]
      expect(allUserBindings.map(item => item.id).sort()).toEqual([b1.resource.id, b1Other.resource.id].sort())
      expect(allUserBindings.map(item => item.setor?.id).sort()).toEqual([s1.resource.id, s2.resource.id].sort())

      const emptyUser = await request(baseUrl, admin.session.accessToken, '/admin/users/usuario-sem-vinculo/sectors')
      expect(emptyUser.status).toBe(200)
      const emptyBody = (await emptyUser.json()) as HalCollection<UserSectorResource, 'sectors'>
      expect(emptyBody.page.totalElements).toBe(0)
      expect(emptyBody._embedded.sectors).toEqual([])
    }))

  it('altera papel, remove papel com null e desvincula preservando usuário e setor', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-role-cycle')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor Ciclo Papel' })
      const binding = await vincularUsuarioAoSetor({ baseUrl }, session, {
        usuarioId: user.id,
        setorId: sector.resource.id,
      })

      const setRole = await request(baseUrl, session.accessToken, `/admin/user-sectors/${binding.resource.id}`, 'PATCH', {
        papelId: 'integration-reference-role',
      })
      expect(setRole.status).toBe(200)
      expect(await setRole.json()).toMatchObject({
        id: binding.resource.id,
        papelId: 'integration-reference-role',
      })

      const clearRole = await request(
        baseUrl,
        session.accessToken,
        `/admin/user-sectors/${binding.resource.id}`,
        'PATCH',
        { papelId: null },
      )
      expect(clearRole.status).toBe(200)
      expect(await clearRole.json()).toMatchObject({
        id: binding.resource.id,
        usuarioId: user.id,
        setorId: sector.resource.id,
        papelId: null,
      })
      expect(await db.usuarioSetor.findUnique({ where: { id: binding.resource.id } })).toMatchObject({
        usuarioId: user.id,
        setorId: sector.resource.id,
        papelId: null,
      })

      const del = await request(baseUrl, session.accessToken, `/admin/user-sectors/${binding.resource.id}`, 'DELETE')
      expect(del.status).toBe(204)
      expect(await del.text()).toBe('')
      expect(await db.usuarioSetor.count({ where: { id: binding.resource.id } })).toBe(0)
      expect(await db.usuario.count({ where: { id: user.id } })).toBe(1)
      expect(await db.setor.count({ where: { id: sector.resource.id } })).toBe(1)
    }))

  it('retorna 400 para entrada inválida e 404 para vínculo inexistente', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-missing-admin')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor Validação' })

      const invalidBody = await request(baseUrl, session.accessToken, `/admin/users/${user.id}/sectors`, 'POST', {})
      expect(invalidBody.status).toBe(400)
      expect(invalidBody.headers.get('content-type')).toContain('application/problem+json')

      const invalidQuery = await request(
        baseUrl,
        session.accessToken,
        `/admin/sectors/${sector.resource.id}/users?size=101`,
      )
      expect(invalidQuery.status).toBe(400)
      expect(invalidQuery.headers.get('content-type')).toContain('application/problem+json')

      const path = '/admin/user-sectors/vinculo-inexistente'
      const patchMissing = await request(baseUrl, session.accessToken, path, 'PATCH', { papelId: null })
      expect(patchMissing.status).toBe(404)
      expect(patchMissing.headers.get('content-type')).toContain('application/problem+json')
      expect(((await patchMissing.json()) as ProblemDetails).type).toBe('/errors/not-found')

      const deleteMissing = await request(baseUrl, session.accessToken, path, 'DELETE')
      expect(deleteMissing.status).toBe(404)
      expect(deleteMissing.headers.get('content-type')).toContain('application/problem+json')
    }))

  it('exige autenticação (401) e autoriza os quatro papéis diretamente em todas as rotas de vínculo', async () =>
    withDatabase(async (db, baseUrl) => {
      const admin = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-matrix-owner')
      const sector = await createSetor({ baseUrl }, admin.session, { nome: 'Setor Matriz Vínculos' })

      const anonymousCalls: Array<[string, string, object?]> = [
        [`/admin/users/${admin.user.id}/sectors`, 'POST', { setorId: sector.resource.id }],
        [`/admin/users/${admin.user.id}/sectors`, 'GET'],
        [`/admin/sectors/${sector.resource.id}/users`, 'GET'],
        ['/admin/user-sectors/qualquer', 'PATCH', { papelId: null }],
        ['/admin/user-sectors/qualquer', 'DELETE'],
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
            : await actor(db, baseUrl, role, `binding-matrix-${role.toLowerCase()}`)
        const allowed = role === 'ADMINISTRADOR' || role === 'TECNICO'

        const postRes = await request(
          baseUrl,
          current.session.accessToken,
          `/admin/users/${current.user.id}/sectors`,
          'POST',
          { setorId: sector.resource.id, papelId: 'integration-reference-role' },
        )
        expect(postRes.status, `${role} POST vínculo`).toBe(allowed ? 201 : 403)

        const binding = allowed
          ? ((await postRes.json()) as { id: string })
          : (await vincularUsuarioAoSetor({ baseUrl }, admin.session, {
              usuarioId: current.user.id,
              setorId: sector.resource.id,
            })).resource

        const calls: Array<[string, string, object | undefined, number]> = [
          [`/admin/users/${current.user.id}/sectors`, 'GET', undefined, 200],
          [`/admin/sectors/${sector.resource.id}/users`, 'GET', undefined, 200],
          [`/admin/user-sectors/${binding.id}`, 'PATCH', { papelId: 'integration-reference-role' }, 200],
          [`/admin/user-sectors/${binding.id}`, 'DELETE', undefined, 204],
        ]
        for (const [path, method, body, success] of calls) {
          const res = await request(baseUrl, current.session.accessToken, path, method, body)
          expect(res.status, `${role} ${method} ${path}`).toBe(allowed ? success : 403)
          if (!allowed) {
            expect(res.headers.get('content-type')).toContain('application/problem+json')
          }
        }
        expect(await db.usuarioSetor.count({ where: { id: binding.id } })).toBe(allowed ? 0 : 1)
      }
    }))

  it('rejeita criação concorrente de vínculo idêntico com papel informado', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-concurrency-role')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor Concorrência Papel' })
      const path = `/admin/users/${user.id}/sectors`
      const body = { setorId: sector.resource.id, papelId: 'integration-reference-role' }
      const results = await Promise.all([
        request(baseUrl, session.accessToken, path, 'POST', body),
        request(baseUrl, session.accessToken, path, 'POST', body),
      ])
      expect(results.map(r => r.status).sort()).toEqual([201, 409])
      expect(await db.usuarioSetor.count({ where: { usuarioId: user.id, setorId: sector.resource.id } })).toBe(1)
    }))

  it('impede alterar papel para combinação já existente e preserva ambos os vínculos', async () =>
    withDatabase(async (db, baseUrl) => {
      const { user, session } = await actor(db, baseUrl, 'ADMINISTRADOR', 'binding-role-conflict')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor Conflito Papel' })
      const first = await vincularUsuarioAoSetor({ baseUrl }, session, {
        usuarioId: user.id,
        setorId: sector.resource.id,
        papelId: 'integration-reference-role',
      })
      const second = await vincularUsuarioAoSetor({ baseUrl }, session, {
        usuarioId: user.id,
        setorId: sector.resource.id,
        papelId: null,
      })
      const response = await request(
        baseUrl,
        session.accessToken,
        `/admin/user-sectors/${second.resource.id}`,
        'PATCH',
        { papelId: 'integration-reference-role' },
      )
      expect(response.status).toBe(409)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect(await db.usuarioSetor.findUnique({ where: { id: first.resource.id } })).toMatchObject({
        papelId: 'integration-reference-role',
      })
      expect(await db.usuarioSetor.findUnique({ where: { id: second.resource.id } })).toMatchObject({
        papelId: null,
      })
    }))

  // Regressões conhecidas em produção (BE-12): preservadas até decisão/correção da equipe.
  it('rejeita criação concorrente de vínculo idêntico sem papel', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'concurrency-null-admin')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor sem papel' })
      const path = `/admin/users/${user.id}/sectors`
      const body = { setorId: sector.resource.id, papelId: null }
      const results = await Promise.all([
        request(baseUrl, session.accessToken, path, 'POST', body),
        request(baseUrl, session.accessToken, path, 'POST', body),
      ])
      expect.soft(results.map(r => r.status).sort()).toEqual([201, 409])
      expect(await db.usuarioSetor.count({ where: { usuarioId: user.id, setorId: sector.resource.id } })).toBe(1)
    }))

  it('rejeita criação sequencial de vínculo idêntico sem papel', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'sequential-null-admin')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor repetido' })
      const path = `/admin/users/${user.id}/sectors`
      const body = { setorId: sector.resource.id, papelId: null }
      const first = await request(baseUrl, session.accessToken, path, 'POST', body)
      const second = await request(baseUrl, session.accessToken, path, 'POST', body)
      expect(first.status).toBe(201)
      expect.soft(second.status).toBe(409)
      expect(await db.usuarioSetor.count({ where: { usuarioId: user.id, setorId: sector.resource.id } })).toBe(1)
    }))

  it('rejeita referências inexistentes sem criar vínculos', async () =>
    withDatabase(async (db, baseUrl) => {
      const { session, user } = await actor(db, baseUrl, 'ADMINISTRADOR', 'invalid-admin')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor referência' })
      const invalidSector = await request(baseUrl, session.accessToken, `/admin/users/${user.id}/sectors`, 'POST', {
        setorId: 'inexistente',
      })
      const invalidUser = await request(baseUrl, session.accessToken, '/admin/users/inexistente/sectors', 'POST', {
        setorId: sector.resource.id,
      })
      const invalidRole = await request(baseUrl, session.accessToken, `/admin/users/${user.id}/sectors`, 'POST', {
        setorId: sector.resource.id,
        papelId: 'inexistente',
      })
      expect.soft(invalidSector.status).toBeGreaterThanOrEqual(400)
      expect.soft(invalidSector.status).toBeLessThan(500)
      expect.soft(invalidUser.status).toBeGreaterThanOrEqual(400)
      expect.soft(invalidUser.status).toBeLessThan(500)
      expect.soft(invalidRole.status).toBeGreaterThanOrEqual(400)
      expect.soft(invalidRole.status).toBeLessThan(500)
      expect(await db.usuarioSetor.count({ where: { setorId: sector.resource.id } })).toBe(0)
    }))

  it('rejeita papel inexistente ao alterar vínculo sem modificar o registro', async () =>
    withDatabase(async (db, baseUrl) => {
      const { user, session } = await actor(db, baseUrl, 'ADMINISTRADOR', 'invalid-patch-role')
      const sector = await createSetor({ baseUrl }, session, { nome: 'Setor papel inválido' })
      const binding = await vincularUsuarioAoSetor({ baseUrl }, session, {
        usuarioId: user.id,
        setorId: sector.resource.id,
      })
      const response = await request(
        baseUrl,
        session.accessToken,
        `/admin/user-sectors/${binding.resource.id}`,
        'PATCH',
        { papelId: 'inexistente' },
      )
      expect.soft(response.status).toBeGreaterThanOrEqual(400)
      expect.soft(response.status).toBeLessThan(500)
      expect(await db.usuarioSetor.findUnique({ where: { id: binding.resource.id } })).toMatchObject({
        papelId: null,
      })
    }))
})
