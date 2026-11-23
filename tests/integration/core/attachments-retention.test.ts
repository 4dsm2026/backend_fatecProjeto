import { randomBytes } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { describe, expect, inject, it } from 'vitest'
import { runCleanupAnexos } from '../../../src/jobs/cleanupAnexos'
import { createTicket } from '../_helpers/tickets'
import { createTestApp } from '../_setup/createTestApp'
import { prepareTicketFixtures } from '../_setup/prepareTicketFixtures'

function businessDaysBefore(days: number): Date {
  const date = new Date()
  let count = 0
  while (count < days) {
    date.setDate(date.getDate() - 1)
    if (date.getDay() !== 0 && date.getDay() !== 6) count++
  }
  return date
}

describe('Integração: retenção de anexos', () => {
  it('remove anexo após sete dias úteis e preserva outro ainda no prazo', async () => {
    const f = await prepareTicketFixtures()
    const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId })
    const ctx = await createTestApp()
    const prisma = new PrismaClient({ datasources: { db: { url: inject('integrationDatabaseUrl') } } })
    const suffix = randomBytes(6).toString('hex')
    const expiredPath = join(ctx.storageDir, `expirado-${suffix}.txt`)
    const activePath = join(ctx.storageDir, `ativo-${suffix}.txt`)
    try {
      await Promise.all([writeFile(expiredPath, 'antigo'), writeFile(activePath, 'recente')])
      const expiredAt = businessDaysBefore(7)
      expiredAt.setMinutes(expiredAt.getMinutes() - 1)
      const common = { chamadoId: ticket.id, enviadoPorId: f.funcionario.userId, mimeType: 'text/plain', tamanhoBytes: 6 }
      const old = await prisma.anexo.create({ data: { ...common, nomeArquivo: 'antigo.txt', caminhoArquivo: expiredPath, enviadoEm: expiredAt } })
      const active = await prisma.anexo.create({ data: { ...common, nomeArquivo: 'recente.txt', caminhoArquivo: activePath, enviadoEm: businessDaysBefore(6) } })
      await runCleanupAnexos(prisma, ctx.storageDir)
      expect(await prisma.anexo.findUnique({ where: { id: old.id } })).toBeNull()
      expect(await prisma.anexo.findUnique({ where: { id: active.id } })).not.toBeNull()
      await expect(access(expiredPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(activePath)).resolves.toBeUndefined()
    } finally { await prisma.$disconnect() }
  })
})
