import { PrismaClient } from '@prisma/client'
import { ApiError, fieldErrorsFromZod, isStaff, toSkipTake } from '../../hateoas'
import type { Role } from '../../hateoas'
import { SugestaoRespostaSchema } from '../../validators/sugestoes'
import { SugestaoCreateInput, SugestaoResponderInput, SugestoesListQuery } from './sugestoes.types'

type Ctx = PrismaClient

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
      ...(data.documento !== undefined ? { documento: data.documento } : {}),
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
  opts: { usuarioId: string; role: Role },
) {
  const { page, size } = query
  const { skip, take } = toSkipTake(query)
  const staff = isStaff({ id: opts.usuarioId, role: opts.role })

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
  opts: { usuarioId: string; role: Role },
) {
  const sugestao = await prisma.sugestao.findUnique({
    where: { id },
    include: {
      usuario: { select: { id: true, nome: true, ra: true } },
      respondidoPor: { select: { id: true, nome: true } },
    },
  })

  if (!sugestao) return null
  if (!isStaff({ id: opts.usuarioId, role: opts.role }) && sugestao.usuarioId !== opts.usuarioId) return null

  return sugestao
}

export async function responderSugestao(
  prisma: Ctx,
  id: string,
  data: SugestaoResponderInput,
  opts: { staffId: string; role: Role },
) {
  if (!isStaff({ id: opts.staffId, role: opts.role })) {
    throw new ApiError("forbidden", "Somente a equipe pode responder sugestões");
  }
  const parsedResponse = SugestaoRespostaSchema.safeParse(data.resposta);
  if (!parsedResponse.success) {
    throw new ApiError(
      "bad-request",
      "Resposta inválida",
      undefined,
      fieldErrorsFromZod(parsedResponse.error.issues),
    );
  }

  const atual = await prisma.sugestao.findUnique({
    where: { id },
    select: { id: true, status: true, resposta: true },
  });
  if (!atual) throw new ApiError("not-found", "Sugestão não encontrada");
  if (atual.status === "RESPONDIDO" || atual.resposta) {
    throw new ApiError(
      'conflict',
      'Sugestão já respondida',
      'A resposta não pode ser alterada após ser registrada',
    )
  }

  const updated = await prisma.sugestao.updateMany({
    where: { id, status: "NAO_RESPONDIDO", resposta: null },
    data: {
      resposta: parsedResponse.data,
      ...(data.respostaDocumento !== undefined ? { respostaDocumento: data.respostaDocumento } : {}),
      status: "RESPONDIDO",
      respondidoPorId: opts.staffId,
      respondidoEm: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new ApiError("conflict", "Sugestão já respondida");
  }

  const suggestion = await prisma.sugestao.findUnique({
    where: { id },
    include: {
      usuario: { select: { id: true, nome: true, ra: true } },
      respondidoPor: { select: { id: true, nome: true } },
    },
  });
  if (!suggestion) throw new ApiError("not-found", "Sugestão não encontrada");
  return suggestion;
}
