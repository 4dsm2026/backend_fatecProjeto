import { PrismaClient } from '@prisma/client'
import { ApiError } from '../../hateoas'
import { toSkipTake } from '../../hateoas'
import { SugestaoCreateInput, SugestaoResponderInput, SugestoesListQuery } from './sugestoes.types'

type Ctx = PrismaClient

const STAFF_ROLES = ['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO']
export function isStaffRole(role?: string) {
  return !!role && STAFF_ROLES.includes(role)
}

export async function createSugestao(
  prisma: Ctx,
  data: SugestaoCreateInput,
  opts: { usuarioId?: string },
) {
  const { usuarioId } = opts
  if (!usuarioId) throw new ApiError('unauthorized', 'Não autenticado')

  return prisma.sugestao.create({
    data: {
      usuarioId,
      emailContato: data.emailContato,
      conteudo: data.conteudo,
    },
  })
}

/**
 * Lista sugestões. Alunos (USUARIO) só veem as próprias; staff
 * (ADMINISTRADOR/BACKOFFICE/TECNICO) vê todas, com filtro opcional de status.
 */
export async function listSugestoes(
  prisma: Ctx,
  query: SugestoesListQuery,
  opts: { usuarioId: string; role?: string },
) {
  const { page, size } = query
  const { skip, take } = toSkipTake(query)
  const staff = isStaffRole(opts.role)

  const where = {
    ...(staff ? {} : { usuarioId: opts.usuarioId }),
    ...(query.status ? { status: query.status } : {}),
  }

  const [total, items] = await Promise.all([
    prisma.sugestao.count({ where }),
    prisma.sugestao.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip,
      take,
      include: staff
        ? { usuario: { select: { id: true, nome: true, ra: true } } }
        : undefined,
    }),
  ])

  return { total, page, size, items }
}

export async function getSugestaoById(
  prisma: Ctx,
  id: string,
  opts: { usuarioId: string; role?: string },
) {
  const sugestao = await prisma.sugestao.findUnique({
    where: { id },
    include: {
      usuario: { select: { id: true, nome: true, ra: true } },
      respondidoPor: { select: { id: true, nome: true } },
    },
  })

  if (!sugestao) return null
  if (!isStaffRole(opts.role) && sugestao.usuarioId !== opts.usuarioId) return null

  return sugestao
}

export async function responderSugestao(
  prisma: Ctx,
  id: string,
  data: SugestaoResponderInput,
  opts: { staffId: string },
) {
  const atual = await prisma.sugestao.findUnique({
    where: { id },
    select: { status: true, resposta: true },
  })
  if (!atual) throw new ApiError('not-found', 'Sugestão não encontrada')

  if (atual.status === 'RESPONDIDO') {
    throw new ApiError(
      'conflict',
      'Sugestão já respondida',
      'Resposta e status não podem mais ser alterados',
    )
  }

  if (data.resposta !== undefined && atual.resposta) {
    throw new ApiError(
      'conflict',
      'A resposta já foi salva',
      'A resposta não pode ser editada',
    )
  }

  return prisma.sugestao.update({
    where: { id },
    data: {
      ...(data.resposta !== undefined ? { resposta: data.resposta } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      respondidoPorId: opts.staffId,
      respondidoEm: new Date(),
    },
  })
}
