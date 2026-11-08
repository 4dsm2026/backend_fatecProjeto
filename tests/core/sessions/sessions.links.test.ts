import { describe, it, expect } from 'vitest'
import {
  buildSessionLinks,
  buildTokenLinks,
  buildPasswordResetRequestLinks,
  buildActivationRequiredLinks,
  buildCurrentUserLinks,
} from '../../../src/core/sessions/sessions.links'
import type { Role } from '../../../src/hateoas'

const ROLES: Role[] = ['USUARIO', 'BACKOFFICE', 'TECNICO', 'ADMINISTRADOR']

describe('buildSessionLinks', () => {
  it('traz self, logout, refresh, user, password e entry com href e método corretos', () => {
    expect(buildSessionLinks()).toEqual({
      self: { href: '/sessions/current', method: 'GET' },
      logout: { href: '/sessions/current', method: 'DELETE' },
      refresh: { href: '/tokens', method: 'POST' },
      user: { href: '/users/me', method: 'GET' },
      password: { href: '/users/me/password', method: 'PUT' },
      entry: { href: '/api', method: 'GET' },
    })
  })
})

describe('buildTokenLinks', () => {
  it('não tem self (token não é recurso endereçável) e leva aos próximos passos', () => {
    const links = buildTokenLinks()
    expect(links).not.toHaveProperty('self')
    expect(Object.keys(links).sort()).toEqual(['refresh', 'session', 'user'])
  })
})

describe('buildPasswordResetRequestLinks', () => {
  it('só aponta para o login, sem self', () => {
    expect(buildPasswordResetRequestLinks()).toEqual({ login: { href: '/sessions', method: 'POST' } })
  })
})

describe('buildActivationRequiredLinks', () => {
  it('monta o link activate com o token', () => {
    expect(buildActivationRequiredLinks('abc123')).toEqual({
      activate: { href: '/account-activations/abc123', method: 'PUT' },
    })
  })

  it('codifica o token na URL (sem path traversal)', () => {
    expect(buildActivationRequiredLinks('../../x/y?z').activate).toMatchObject({
      href: '/account-activations/..%2F..%2Fx%2Fy%3Fz',
    })
  })
})

describe('buildCurrentUserLinks', () => {
  it.each(ROLES)('papel %s: links de conta iguais; update só se permitido', (role) => {
    const viewer = { id: 'u-1', role }

    const comUpdate = buildCurrentUserLinks(viewer, { canUpdate: true })
    expect(comUpdate.update).toEqual({ href: '/users/u-1', method: 'PATCH' })
    expect(comUpdate.self).toEqual({ href: '/users/me', method: 'GET' })
    expect(comUpdate.password).toEqual({ href: '/users/me/password', method: 'PUT' })
    expect(comUpdate.logout).toEqual({ href: '/sessions/current', method: 'DELETE' })

    const semUpdate = buildCurrentUserLinks(viewer, { canUpdate: false })
    expect(semUpdate).not.toHaveProperty('update')
    expect(semUpdate.self).toBeDefined()
  })

  it('codifica o id do usuário no href do update', () => {
    const links = buildCurrentUserLinks({ id: 'a/b', role: 'USUARIO' }, { canUpdate: true })
    expect(links.update).toMatchObject({ href: '/users/a%2Fb' })
  })

  it('mescla os links por papel recebidos em extra', () => {
    const links = buildCurrentUserLinks(
      { id: 'u-1', role: 'ADMINISTRADOR' },
      { canUpdate: false, extra: { tickets: { href: '/tickets', method: 'GET' } } },
    )
    expect(links.tickets).toEqual({ href: '/tickets', method: 'GET' })
    expect(links.self).toBeDefined()
  })
})
