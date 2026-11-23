import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { inject } from 'vitest'
import type { Actor, Role, Session, TestContext } from '../_setup/contracts'

/** Cria apenas a pré-condição; autenticação e ações testadas passam pela API. */
export async function createUser(ctx: TestContext, role: Role): Promise<Actor> {
  if (!ctx.baseUrl) throw new Error('API de teste indisponível')
  const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
  const suffix = randomBytes(8).toString('hex')
  const email = `integration-${suffix}@example.test`
  const password = `Auth-${randomBytes(20).toString('hex')}aA1!`
  try {
    const { hash } = await import('argon2')
    const user = await prisma.usuario.create({ data: {
      nome: `Usuário ${suffix}`, emailPessoal: email, senhaHash: await hash(password),
      papel: role, precisaTrocarSenha: false,
    } })
    return { id: user.id, role, email, password }
  } finally {
    await prisma.$disconnect()
  }
}

export async function loginAs(ctx: TestContext, actor: Actor): Promise<Session> {
  const response = await fetch(new URL('/sessions', ctx.baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  })
  if (response.status !== 201) throw new Error(`Login falhou: ${response.status} ${await response.text()}`)
  const tokens = await response.json() as { accessToken: string; refreshToken: string }
  if (!tokens.accessToken || !tokens.refreshToken) throw new Error('Login sem tokens esperados')
  return { actor, ...tokens }
}
