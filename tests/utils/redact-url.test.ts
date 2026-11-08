import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/prisma')
vi.mock('../../src/jobs/cleanupAnexos', () => ({ scheduleCleanupAnexos: vi.fn() }))

import { buildApp } from '../../src/app'
import { redactUrl, REDACTED } from '../../src/utils/redact-url'

describe('redactUrl', () => {
  it.each([
    ['/password-resets/abc123', `/password-resets/${REDACTED}`],
    ['/account-activations/abc123', `/account-activations/${REDACTED}`],
    ['/password-resets/abc123?x=1', `/password-resets/${REDACTED}?x=1`],
    ['/password-resets/a%2Fb', `/password-resets/${REDACTED}`],
    ['/reset-senha?token=abc123&b=2', `/reset-senha?token=${REDACTED}&b=2`],
    ['/x?a=1&token=abc123', `/x?a=1&token=${REDACTED}`],
  ])('esconde o segredo: %s', (entrada, esperado) => {
    expect(redactUrl(entrada)).toBe(esperado)
  })

  it.each([
    ['/password-resets'],
    ['/password-resets/'],
    ['/users/me'],
    ['/tickets/abc123'],
    ['/sessions/current'],
    ['/outra/password-resets/abc123'],
  ])('não mexe no que não é segredo: %s', (url) => {
    expect(redactUrl(url)).toBe(url)
  })

  it('aceita undefined sem lançar', () => {
    expect(redactUrl(undefined)).toBe('')
  })

  it('não deixa o token cru em nenhum lugar da saída', () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2'
    expect(redactUrl(`/password-resets/${token}`)).not.toContain(token)
  })
})

describe('o logger REAL do app usa o redator (ligação)', () => {
  it('o serializador de req do app esconde o token da URL e mantém o resto', async () => {
    const app = await buildApp()
    await app.ready()
    const serializers = (app.log as any)[Symbol.for('pino.serializers')] as Record<string, (r: unknown) => any>

    const linha = serializers.req({
      method: 'PUT',
      url: '/password-resets/segredo-do-token',
      headers: { 'accept-version': '1.0.0' },
      host: 'localhost',
      // eslint-disable-next-line sonarjs/no-hardcoded-ip -- dado fictício de teste
      ip: '10.0.0.7',
      socket: { remotePort: 5555 },
    })

    expect(linha.url).toBe(`/password-resets/${REDACTED}`)
    expect(JSON.stringify(linha)).not.toContain('segredo-do-token')
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- dado fictício de teste
    expect(linha).toMatchObject({ method: 'PUT', host: 'localhost', remoteAddress: '10.0.0.7', remotePort: 5555 })
    await app.close()
  })
})
