import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { createTestApp } from '../_setup/createTestApp'

describe('Integração: entrada dos módulos adicionados ao projeto', () => {
  it.each([
    { path: '/school-passes', rel: 'school-passes' },
    { path: '/surveys', rel: 'surveys' },
    { path: '/enrollment-requests', rel: 'enrollment-requests' },
  ])('oferece e consulta $path com login real', async ({ path, rel }) => {
    const ctx = await createTestApp()
    const session = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const options = { headers: { authorization: `Bearer ${session.accessToken}` } }
    const entry = await fetch(new URL('/api', ctx.baseUrl), options)
    expect(entry.status).toBe(200)
    const root = await entry.json() as { _links: Record<string, { href: string }> }
    expect(root._links[rel]?.href).toBe(path)
    const response = await fetch(new URL(path, ctx.baseUrl), options)
    expect(response.status).toBe(200)
    const body = await response.json() as { _links: Record<string, unknown> }
    expect(body._links).toHaveProperty('self')
  })
})
