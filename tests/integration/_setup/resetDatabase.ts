import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { inject } from 'vitest'
import type { HarnessContext } from './contracts'
import { seedReference } from './seedReference'

const PRESERVED_TABLES = new Set(['_prisma_migrations', '_integration_owner'])

/** Ordem estrita de exclusão respeitando todas as FKs do schema.prisma. */
const DELETE_ORDER = [
  'notificacoes',
  'email_envios',
  'anexos',
  'mensagens',
  'historico_status_chamado',
  'chamados_tags',
  'tags',
  'auditoria',
  'sugestoes',
  'chamados',
  'servicos',
  'categorias',
  'contratos',
  'clientes',
  'tokens_reset_senha',
  'login_tentativas',
  'sessoes',
  'usuarios_setores',
  'papeis',
  'setores',
  'usuarios',
  'organizacoes',
  'comunicacao_templates',
] as const

const KNOWN_TABLES = new Set<string>(DELETE_ORDER)

function assertSafeStorageDir(rawDir: string): string {
  const baseTemp = resolve(tmpdir())
  const resolved = resolve(rawDir)
  const prefix = baseTemp.endsWith(sep) ? baseTemp : `${baseTemp}${sep}`
  if (!resolved.startsWith(prefix) || !basename(resolved).startsWith('workflow-integration-')) {
    throw new Error('Diretório de storage inválido para limpeza de integração')
  }
  return resolved
}

async function clearStorageDir(rawDir?: string): Promise<void> {
  if (!rawDir) return
  const safeDir = assertSafeStorageDir(rawDir)
  for (const entry of await readdir(safeDir)) {
    await rm(join(safeDir, entry), { recursive: true, force: true })
  }
}

/**
 * Só recebe a capacidade entregue pelo globalSetup, nunca DATABASE_URL ou um cliente externo.
 * Deve ser chamado apenas com a suíte serial e efeitos assíncronos drenados.
 */
export async function resetDatabase(ctx?: Partial<HarnessContext>): Promise<void> {
  const url = inject('integrationDatabaseUrl')
  const token = inject('integrationToken')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await prisma.$transaction(async tx => {
      const owner = await tx.$queryRaw<Array<{ token: string }>>`SELECT token FROM _integration_owner`
      if (owner.length !== 1 || owner[0].token !== token) throw new Error('Banco não pertence a esta execução')

      const tables = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT TABLE_NAME AS name FROM information_schema.tables
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      `
      const unknownTables = tables
        .map(t => t.name)
        .filter(name => !PRESERVED_TABLES.has(name) && !KNOWN_TABLES.has(name))
      if (unknownTables.length > 0) {
        throw new Error(`Tabelas não mapeadas no resetDatabase: ${unknownTables.join(', ')}`)
      }

      await tx.$executeRawUnsafe('UPDATE `sessoes` SET `substituidaPorId` = NULL WHERE `substituidaPorId` IS NOT NULL')
      for (const table of DELETE_ORDER) {
        await tx.$executeRawUnsafe(`DELETE FROM \`${table}\``)
      }
      await seedReference(tx)
    }, { timeout: 30_000 })
    await clearStorageDir(ctx?.storageDir ?? process.env.LOCAL_STORAGE_DIR)
  } finally {
    await prisma.$disconnect()
  }
}
