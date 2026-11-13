import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { inject } from 'vitest'
import { createSetor, vincularUsuarioAoSetor } from '../_helpers/setores'
import type { PrepareTicketFixtures, TicketFixtures } from '../tickets/fixtures'
import type { Actor, Role, Session, TestContext } from './contracts'
import { createTestApp } from './createTestApp'
import { resetDatabase } from './resetDatabase'

export type TicketAuthDeps = {
  createUser: (ctx: TestContext, role: Role, overrides?: { nome?: string; email?: string; password?: string }) => Promise<Actor>
  loginAs: (ctx: TestContext, actor: Actor) => Promise<Session>
}

async function defaultCreateUser(
  role: Role,
  overrides: { nome?: string; email?: string; password?: string } = {},
): Promise<Actor> {
  const { hash } = await import('argon2')
  const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
  const password = overrides.password ?? `TicketFixture-${randomBytes(16).toString('hex')}aA1!`
  const suffix = randomBytes(6).toString('hex')
  const email = overrides.email ?? `${role.toLowerCase()}-${suffix}@example.test`
  try {
    const user = await prisma.usuario.create({
      data: {
        nome: overrides.nome ?? `${role} ${suffix}`,
        emailPessoal: email,
        senhaHash: await hash(password),
        papel: role,
        precisaTrocarSenha: false,
      },
    })
    return { id: user.id, role, email, password }
  } finally {
    await prisma.$disconnect()
  }
}

async function defaultLoginAs(ctx: TestContext, actor: Actor): Promise<Session> {
  const response = await fetch(new URL('/sessions', ctx.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  })
  if (response.status !== 201) {
    throw new Error(`POST /sessions falhou (${response.status}): ${await response.text()}`)
  }
  const body = await response.json() as { accessToken: string; refreshToken?: string }
  return {
    actor,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken ?? '',
  }
}

/**
 * Adaptador para conectar `registerTicketScenarios` e `registerJ1` (Matheus)
 * ao harness compartilhado sem duplicar container MySQL ou instância Fastify.
 */
export function createPrepareTicketFixtures(authDeps?: Partial<TicketAuthDeps>): PrepareTicketFixtures {
  return async (): Promise<TicketFixtures> => {
    const ctx = await createTestApp()
    await resetDatabase(ctx)

    const makeUser = async (role: Role, nome: string) => {
      if (authDeps?.createUser) {
        return authDeps.createUser(ctx, role, { nome })
      }
      return defaultCreateUser(role, { nome })
    }
    const doLogin = async (actor: Actor) => {
      if (authDeps?.loginAs) {
        return authDeps.loginAs(ctx, actor)
      }
      return defaultLoginAs(ctx, actor)
    }

    const [studentActor, otherActor, staffActor, backofficeActor, adminActor] = await Promise.all([
      makeUser('USUARIO', 'Aluno'),
      makeUser('USUARIO', 'Outro'),
      makeUser('TECNICO', 'Funcionario'),
      makeUser('BACKOFFICE', 'Backoffice'),
      makeUser('ADMINISTRADOR', 'Admin'),
    ])

    const [aluno, outroAluno, funcionario, backoffice, admin] = await Promise.all([
      doLogin(studentActor),
      doLogin(otherActor),
      doLogin(staffActor),
      doLogin(backofficeActor),
      doLogin(adminActor),
    ])

    const suffix = randomBytes(4).toString('hex')
    const sector = await createSetor(ctx, admin, { nome: `Secretaria ${suffix}` })
    await vincularUsuarioAoSetor(ctx, admin, {
      usuarioId: staffActor.id,
      setorId: sector.resource.id,
    })

    return {
      ctx: { baseUrl: ctx.baseUrl },
      aluno,
      outroAluno,
      funcionario: { accessToken: funcionario.accessToken, userId: staffActor.id },
      backoffice,
      admin,
      setorId: sector.resource.id,
      async setEncerradoEm(ticketId: string, date: Date) {
        const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
        try {
          await prisma.chamado.update({ where: { id: ticketId }, data: { encerradoEm: date } })
        } finally {
          await prisma.$disconnect()
        }
      },
    }
  }
}

export const prepareTicketFixtures: PrepareTicketFixtures = createPrepareTicketFixtures()
