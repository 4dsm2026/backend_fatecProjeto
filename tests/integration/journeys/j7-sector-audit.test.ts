import { randomBytes } from 'node:crypto'
import type { Papel, PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { createSetor, vincularUsuarioAoSetor } from '../_helpers/setores'
import { assignTicket, changeStatus, createTicket } from '../_helpers/tickets'
import type { HalCollection } from '../_setup/contracts'
import { createTestApp } from '../_setup/createTestApp'

const FIXTURE_PASSWORD = `J7-Fixture-${randomBytes(12).toString('hex')}aA1!`

async function createSeedActor(prisma: PrismaClient, baseUrl: string, role: Papel, label: string) {
  const { hash } = await import('argon2')
  const email = `${label}-${randomBytes(4).toString('hex')}@example.test`
  const user = await prisma.usuario.create({
    data: {
      nome: label,
      emailPessoal: email,
      senhaHash: await hash(FIXTURE_PASSWORD),
      papel: role,
      precisaTrocarSenha: false,
    },
  })
  const session = await loginWithCredentials(baseUrl, email, FIXTURE_PASSWORD)
  return { user, session }
}

async function loginWithCredentials(baseUrl: string, email: string, password: string) {
  const res = await fetch(new URL('/sessions', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(res.status, `login ${email}`).toBe(201)
  return (await res.json()) as { accessToken: string; user: { id: string; papel: Papel } }
}

function apiRequest(baseUrl: string, token: string, path: string, method = 'GET', body?: object) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

type TicketSummary = { id: string; setorId: string | null; protocolo: string; status: string; arquivadoEm: string | null }
type NotificationItem = { id: string; tipo: string; chamadoId: string | null }
type AuditLogItem = {
  id: string
  acao: string
  alvo: string | null
  feitoPorId: string | null
  meta?: Record<string, unknown> | null
}

describe('J7: criação de funcionário, vínculo, fila do setor e auditoria', () => {
  it('cria funcionário por HTTP, vincula ao setor, roteia chamado, valida isolamento e correlaciona auditoria', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    try {
      const ctx = await createTestApp()
      const baseUrl = ctx.baseUrl
      const journeyStart = new Date(Date.now() - 1000)

      const admin = await createSeedActor(prisma, baseUrl, 'ADMINISTRADOR', 'j7-admin')
      const aluno = await createSeedActor(prisma, baseUrl, 'USUARIO', 'j7-aluno')
      const outroAluno = await createSeedActor(prisma, baseUrl, 'USUARIO', 'j7-outro-aluno')

      // 1. Administrador cria funcionário por HTTP e funcionário autentica por HTTP real.
      const employeeEmail = `j7-tecnico-${randomBytes(4).toString('hex')}@example.test`
      const employeePassword = `Tech-${randomBytes(12).toString('hex')}aA1!`
      const createEmployeeRes = await apiRequest(baseUrl, admin.session.accessToken, '/users', 'POST', {
        nome: 'Técnico J7',
        emailPessoal: employeeEmail,
        papel: 'TECNICO',
        ativo: true,
        senha: employeePassword,
      })
      expect(createEmployeeRes.status).toBe(201)
      const createdEmployee = (await createEmployeeRes.json()) as { id: string; papel: string }
      expect(createEmployeeRes.headers.get('location')).toBe(`/users/${createdEmployee.id}`)
      expect(createdEmployee.papel).toBe('TECNICO')

      const employeeSession = await loginWithCredentials(baseUrl, employeeEmail, employeePassword)
      expect(employeeSession.user.id).toBe(createdEmployee.id)

      // 2. Administrador cria dois setores e vincula o funcionário apenas ao primeiro.
      const targetSector = await createSetor(ctx, admin.session, { nome: 'Secretaria J7' })
      const otherSector = await createSetor(ctx, admin.session, { nome: 'Financeiro J7' })

      const binding = await vincularUsuarioAoSetor(ctx, admin.session, {
        usuarioId: createdEmployee.id,
        setorId: targetSector.resource.id,
        papelId: 'integration-reference-role',
      })
      expect(binding.resource.setorId).toBe(targetSector.resource.id)
      expect(binding.resource.usuarioId).toBe(createdEmployee.id)

      // 3. Aluno cria chamado direcionado ao setor do funcionário e outro para setor distinto.
      const targetTicket = await createTicket(ctx, aluno.session, {
        titulo: 'Dúvida matrícula J7',
        descricao: 'Chamado destinado ao setor Secretaria J7.',
        setorId: targetSector.resource.id,
      })
      const otherTicket = await createTicket(ctx, aluno.session, {
        titulo: 'Dúvida boleto J7',
        descricao: 'Chamado destinado ao setor Financeiro J7.',
        setorId: otherSector.resource.id,
      })
      expect(targetTicket.setorId).toBe(targetSector.resource.id)
      expect(targetTicket.status).toBe('ABERTO')

      // 4. Chamado chegou ao setor correto e notificou o funcionário vinculado.
      const notifRes = await apiRequest(baseUrl, employeeSession.accessToken, '/notifications?page=0&size=20')
      expect(notifRes.status).toBe(200)
      const notifications = (await notifRes.json()) as HalCollection<NotificationItem, 'notifications'>
      const notifiedTicketIds = notifications._embedded.notifications
        .filter(n => n.tipo === 'CHAMADO_CRIADO')
        .map(n => n.chamadoId)
      expect(notifiedTicketIds).toContain(targetTicket.id)
      expect(notifiedTicketIds).not.toContain(otherTicket.id)

      // 5. Funcionário consulta a fila do seu setor, assume, resolve; aluno encerra e admin arquiva.
      const queueRes = await apiRequest(
        baseUrl,
        employeeSession.accessToken,
        `/tickets?setorId=${encodeURIComponent(targetSector.resource.id)}&page=0&size=20`,
      )
      expect(queueRes.status).toBe(200)
      const queue = (await queueRes.json()) as HalCollection<TicketSummary, 'tickets'>
      const queueIds = queue._embedded.tickets.map(t => t.id)
      expect(queueIds).toContain(targetTicket.id)
      expect(queueIds).not.toContain(otherTicket.id)

      await assignTicket(ctx, employeeSession, targetTicket.id, createdEmployee.id)
      await changeStatus(ctx, employeeSession, targetTicket.id, 'EM_ATENDIMENTO')
      await changeStatus(ctx, employeeSession, targetTicket.id, 'RESOLVIDO')
      await changeStatus(ctx, aluno.session, targetTicket.id, 'ENCERRADO')

      const archiveRes = await apiRequest(baseUrl, admin.session.accessToken, `/tickets/${targetTicket.id}`, 'PATCH', {
        arquivado: true,
      })
      expect(archiveRes.status).toBe(200)
      const archived = (await archiveRes.json()) as TicketSummary
      expect(archived.status).toBe('ENCERRADO')
      expect(archived.arquivadoEm).toBeTruthy()

      // Histórico do chamado confirma transições reais pelos atores da jornada.
      const ticketDetailRes = await apiRequest(baseUrl, admin.session.accessToken, `/tickets/${targetTicket.id}`)
      expect(ticketDetailRes.status).toBe(200)
      const ticketDetail = (await ticketDetailRes.json()) as {
        historico: Array<{ de: string | null; para: string; porUsuarioId: string | null }>
      }
      expect(ticketDetail.historico).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ de: null, para: 'ABERTO', porUsuarioId: aluno.user.id }),
          expect.objectContaining({ de: 'ABERTO', para: 'EM_ATENDIMENTO', porUsuarioId: createdEmployee.id }),
          expect.objectContaining({ de: 'EM_ATENDIMENTO', para: 'RESOLVIDO', porUsuarioId: createdEmployee.id }),
          expect.objectContaining({ de: 'RESOLVIDO', para: 'ENCERRADO', porUsuarioId: aluno.user.id }),
        ]),
      )

      // 6. Usuários não autorizados são bloqueados nos recursos indevidos.
      expect((await apiRequest(baseUrl, outroAluno.session.accessToken, `/tickets/${targetTicket.id}`)).status).toBe(404)
      expect((await apiRequest(baseUrl, aluno.session.accessToken, '/admin/sectors')).status).toBe(403)
      expect(
        (await apiRequest(baseUrl, aluno.session.accessToken, `/admin/users/${createdEmployee.id}/sectors`)).status,
      ).toBe(403)
      expect((await apiRequest(baseUrl, aluno.session.accessToken, '/admin/audit-logs')).status).toBe(403)
      expect(
        (await apiRequest(baseUrl, employeeSession.accessToken, '/admin/sectors', 'POST', { nome: 'Indevido' })).status,
      ).toBe(403)
      expect(
        (await apiRequest(baseUrl, employeeSession.accessToken, `/tickets/${otherTicket.id}`, 'PATCH', { arquivado: true }))
          .status,
      ).toBe(403)
      expect((await apiRequest(baseUrl, employeeSession.accessToken, '/admin/audit-logs')).status).toBe(403)

      // 7. Auditoria registra e permite consultar eventos reais emitidos pelo sistema.
      const journeyEnd = new Date(Date.now() + 1000)
      const auditQuery = new URLSearchParams({
        userId: admin.user.id,
        from: journeyStart.toISOString(),
        to: journeyEnd.toISOString(),
        page: '0',
        size: '50',
      })
      const auditRes = await apiRequest(baseUrl, admin.session.accessToken, `/admin/audit-logs?${auditQuery.toString()}`)
      expect(auditRes.status).toBe(200)
      const auditCollection = (await auditRes.json()) as HalCollection<AuditLogItem, 'audit-logs'>
      const logs = auditCollection._embedded['audit-logs']

      const createdUserLog = logs.find(
        l => l.acao === 'USUARIO_CRIADO' && l.alvo === `usuarios:${createdEmployee.id}`,
      )
      const archivedTicketLog = logs.find(
        l => l.acao === 'ARQUIVAR_CHAMADO' && l.alvo === targetTicket.id,
      )

      expect(createdUserLog).toBeDefined()
      expect(createdUserLog?.feitoPorId).toBe(admin.user.id)
      expect(archivedTicketLog).toBeDefined()
      expect(archivedTicketLog?.feitoPorId).toBe(admin.user.id)
      expect(archivedTicketLog?.meta).toMatchObject({ protocolo: targetTicket.protocolo })

      const singleAuditRes = await apiRequest(
        baseUrl,
        admin.session.accessToken,
        `/admin/audit-logs/${createdUserLog!.id}`,
      )
      expect(singleAuditRes.status).toBe(200)
      expect(await singleAuditRes.json()).toMatchObject({
        id: createdUserLog!.id,
        acao: 'USUARIO_CRIADO',
        alvo: `usuarios:${createdEmployee.id}`,
      })
    } finally {
      await prisma.$disconnect()
    }
  })
})
