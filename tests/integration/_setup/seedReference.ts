import type { Prisma, PrismaClient } from '@prisma/client'

type PrismaDbClient = PrismaClient | Prisma.TransactionClient

/** Referência mínima; usuários e login permanecem responsabilidade de Rodrigo. */
export async function seedReference(prisma: PrismaDbClient): Promise<void> {
  await prisma.papelCatalogo.create({ data: { id: 'integration-reference-role', nome: 'Referência de teste' } })
}
