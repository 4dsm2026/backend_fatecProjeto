import { generateAccessToken } from '../../src/utils/jwt'

export type TestRole = 'USUARIO' | 'BACKOFFICE' | 'TECNICO' | 'ADMINISTRADOR'

export function makeAdminToken(overrides: { sub?: string; email?: string } = {}) {
  return generateAccessToken({
    sub: overrides.sub ?? 'admin-id-001',
    email: overrides.email ?? 'admin@test.com',
    role: 'ADMINISTRADOR',
  })
}

export function makeUserToken(overrides: { sub?: string; email?: string; role?: TestRole } = {}) {
  return generateAccessToken({
    sub: overrides.sub ?? 'user-id-001',
    email: overrides.email ?? 'user@test.com',
    role: overrides.role ?? 'USUARIO',
  })
}

export function bearerAuth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}
