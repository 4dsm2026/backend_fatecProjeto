import { describe, it, expect } from 'vitest'
import { zStrongPassword } from '../../src/utils/zod-helpers'
import { FirstAccessSchema, ResetSenhaSchema, TrocarSenhaSchema } from '../../src/validators/auth'

const STRONG = 'NovaSenha1#'
const TOKEN = 'token-com-mais-de-10-caracteres'

describe('zStrongPassword (política única de senha)', () => {
  it('aceita senha com 8+ caracteres, maiúscula, minúscula, número e símbolo', () => {
    expect(zStrongPassword.safeParse(STRONG).success).toBe(true)
  })

  it.each([
    ['curta demais', 'Ab1#xyz', 'Mínimo de 8 caracteres'],
    ['sem maiúscula', 'novasenha1#', 'Inclua ao menos uma letra maiúscula'],
    ['sem minúscula', 'NOVASENHA1#', 'Inclua ao menos uma letra minúscula'],
    ['sem número', 'NovaSenha##', 'Inclua ao menos um número'],
    ['sem símbolo', 'NovaSenha12', 'Inclua ao menos um símbolo'],
  ])('rejeita senha %s', (_nome, senha, mensagem) => {
    const r = zStrongPassword.safeParse(senha)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain(mensagem)
  })

  it('apara espaços nas pontas e devolve o valor aparado', () => {
    const r = zStrongPassword.safeParse(`  ${STRONG}  `)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe(STRONG)
  })

  it('valida o valor aparado: 7 caracteres + espaços não passa', () => {
    expect(zStrongPassword.safeParse('  Ab1#xyz  ').success).toBe(false)
  })
})

describe('os três fluxos de senha usam a MESMA política', () => {
  const casos = [
    ['FirstAccessSchema', (senha: string) => FirstAccessSchema.safeParse({ token: TOKEN, newPassword: senha })],
    ['ResetSenhaSchema', (senha: string) => ResetSenhaSchema.safeParse({ token: TOKEN, newPassword: senha })],
    ['TrocarSenhaSchema', (senha: string) => TrocarSenhaSchema.safeParse({ senhaAtual: 'x', novaSenha: senha })],
  ] as const

  describe.each(casos)('%s', (_nome, parse) => {
    it('aceita senha forte', () => {
      expect(parse(STRONG).success).toBe(true)
    })

    it.each(['novasenha1#', 'NOVASENHA1#', 'NovaSenha##', 'NovaSenha12', 'Ab1#xyz'])(
      'rejeita senha fraca %s',
      (fraca) => {
        expect(parse(fraca).success).toBe(false)
      },
    )
  })
})
