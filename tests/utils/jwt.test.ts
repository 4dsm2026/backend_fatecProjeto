import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateDownloadToken,
  verifyDownloadToken,
} from '../../src/utils/jwt'

const claims = { sub: 'user-1', email: 'a@a.com', role: 'USUARIO' }

/** Executa `fn` com uma variável de ambiente alterada e SEMPRE a restaura. */
function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const original = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return fn()
  } finally {
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
}

describe('access token', () => {
  it('lança erro quando JWT_ACCESS_SECRET não existe', () => {
    withEnv('JWT_ACCESS_SECRET', undefined, () => {
      expect(() => generateAccessToken(claims)).toThrow('JWT_ACCESS_SECRET não definido')
    })
  })

  it('gera um token que o verify aceita e devolve as claims', () => {
    const payload = verifyAccessToken(generateAccessToken(claims))
    expect(payload).toMatchObject(claims)
    expect(payload.iss).toBe('helpdesk')
    expect(payload.aud).toBe('helpdesk-app')
    expect(payload.exp).toBeGreaterThan(payload.iat as number)
  })

  it('inclui a claim sid quando informada (id da sessão)', () => {
    const payload = verifyAccessToken(generateAccessToken({ ...claims, sid: 'sessao-9' }))
    expect(payload.sid).toBe('sessao-9')
  })

  it('não inclui a claim sid quando não informada (tokens legados)', () => {
    const payload = verifyAccessToken(generateAccessToken(claims))
    expect(payload).not.toHaveProperty('sid')
  })

  it('usa a expiração informada em opts', () => {
    const payload = verifyAccessToken(generateAccessToken(claims, { expiresIn: 60 }))
    expect((payload.exp as number) - (payload.iat as number)).toBe(60)
  })

  it('rejeita token expirado', () => {
    const expired = generateAccessToken(claims, { expiresIn: -60 })
    expect(() => verifyAccessToken(expired)).toThrow('Token inválido ou expirado')
  })

  it('rejeita token assinado com outro segredo', () => {
    const token = withEnv('JWT_ACCESS_SECRET', 'outro-segredo-qualquer', () => generateAccessToken(claims))
    expect(() => verifyAccessToken(token)).toThrow('Token inválido ou expirado')
  })

  it('rejeita lixo que não é JWT', () => {
    expect(() => verifyAccessToken('isto-nao-e-um-jwt')).toThrow('Token inválido ou expirado')
  })

  it('rejeita token com algoritmo diferente de HS256', () => {
    const secret = process.env.JWT_ACCESS_SECRET as string
    const hs512 = jwt.sign(claims, secret, {
      algorithm: 'HS512',
      issuer: 'helpdesk',
      audience: 'helpdesk-app',
      expiresIn: 60,
    })
    expect(() => verifyAccessToken(hs512)).toThrow('Token inválido ou expirado')
  })
})

describe('refresh token', () => {
  it('gera e verifica o sub', () => {
    expect(verifyRefreshToken(generateRefreshToken({ sub: 'user-1' })).sub).toBe('user-1')
  })

  it('rejeita token expirado', () => {
    const expired = generateRefreshToken({ sub: 'user-1' }, { expiresIn: -60 })
    expect(() => verifyRefreshToken(expired)).toThrow('Token inválido ou expirado')
  })
})

describe('download token', () => {
  it('gera e verifica com purpose DOWNLOAD', () => {
    const payload = verifyDownloadToken(generateDownloadToken({ sub: 'user-1', anexoId: 'anexo-1' }))
    expect(payload).toMatchObject({ sub: 'user-1', anexoId: 'anexo-1', purpose: 'DOWNLOAD' })
  })

  it('um access token NÃO vale como download token (audience diferente)', () => {
    expect(() => verifyDownloadToken(generateAccessToken(claims))).toThrow('Token inválido ou expirado')
  })

  it('um download token NÃO vale como access token (audience diferente)', () => {
    const download = generateDownloadToken({ sub: 'user-1', anexoId: 'anexo-1' })
    expect(() => verifyAccessToken(download)).toThrow('Token inválido ou expirado')
  })
})
