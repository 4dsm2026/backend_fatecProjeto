import { PrismaClient } from '@prisma/client'
import { SugestaoCreateInput, SugestoesListQuery } from './sugestoes.types'

type Ctx = PrismaClient

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

export async function createSugestao(
  prisma: Ctx,
  data: SugestaoCreateInput,
  opts: { usuarioId?: string },
) {
  const { usuarioId } = opts
  if (!usuarioId) throw Object.assign(new Error('Não autenticado'), { code: 'UNAUTH' })

  return prisma.sugestao.create({
    data: {
      usuarioId,
      conteudo: data.conteudo,
    },
  })
}

/**
 * Lista as sugestões do próprio usuário autenticado.
 * (Escopo atual não previu tela administrativa de listagem; mantido simples
 * para eventual uso futuro sem expor sugestões de outros usuários.)
 */
export async function listMinhasSugestoes(
  prisma: Ctx,
  usuarioId: string,
  query: SugestoesListQuery,
) {
  const page = query.page ?? 1
  const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)

  const [total, items] = await Promise.all([
    prisma.sugestao.count({ where: { usuarioId } }),
    prisma.sugestao.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return { total, page, pageSize, items }
}
