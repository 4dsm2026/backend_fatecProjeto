import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { walkGetLinks } from '../_helpers/contractWalker'
import { createTestApp } from '../_setup/createTestApp'

describe('Integração: navegação segura HAL', () => {
  it('segue links GET locais com limite e preserva a sessão', async () => {
    const ctx = await createTestApp()
    const session = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const results = await walkGetLinks(ctx.baseUrl, session.accessToken, '/api', 5)
    expect(results[0]).toEqual({ url: '/api', status: 200 })
    expect(results.length).toBeGreaterThan(1)
    expect(results.length).toBeLessThanOrEqual(5)
    expect(results.every(result => result.status < 400)).toBe(true)
    const current = await fetch(new URL('/sessions/current', ctx.baseUrl), { headers: { authorization: `Bearer ${session.accessToken}` } })
    expect(current.status).toBe(200)
  })
})
