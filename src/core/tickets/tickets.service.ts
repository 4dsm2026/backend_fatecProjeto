// src/core/tickets/tickets.service.ts
import { PrismaClient, StatusChamado } from '@prisma/client'
import { TicketsListQuery, TicketCreateInput, TicketUpdateInput } from './tickets.types'

type Ctx = PrismaClient

const ticketInclude = (include?: TicketsListQuery['include']) => {
  const base = {
    cliente: false,
    contrato: false,
    servico: false,
    setor: false,
    responsavel: false,
    criadoPor: false,
    historico: false,
  }
  if (!include) return base
  const arr = Array.isArray(include) ? include : [include]
  for (const k of arr) (base as any)[k] = true
  return base
}

const buildWhere = (q: TicketsListQuery) => {
  const { search, status, nivel, prioridade, clienteId, contratoId, setorId, servicoId, responsavelId, organizacaoId, criadoDe, criadoAte } = q
  return {
    deletadoEm: null,
    ...(organizacaoId ? { organizacaoId } : {}),
    ...(clienteId ? { clienteId } : {}),
    ...(contratoId ? { contratoId } : {}),
    ...(setorId ? { setorId } : {}),
    ...(servicoId ? { servicoId } : {}),
    ...(responsavelId ? { responsavelId } : {}),
    ...(status
      ? { status: Array.isArray(status) ? { in: status } : status }
      : {}),
    ...(nivel
      ? { nivel: Array.isArray(nivel) ? { in: nivel } : nivel }
      : {}),
    ...(prioridade
      ? { prioridade: Array.isArray(prioridade) ? { in: prioridade } : prioridade }
      : {}),
    ...(criadoDe || criadoAte
      ? {
          criadoEm: {
            ...(criadoDe ? { gte: new Date(criadoDe) } : {}),
            ...(criadoAte ? { lte: new Date(criadoAte) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { titulo: { contains: search, mode: 'insensitive' } },
            { descricao: { contains: search, mode: 'insensitive' } },
            { protocolo: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
}

export async function createTicket(prisma: Ctx, data: TicketCreateInput, opts: { feitoPorId?: string }) {
  const { feitoPorId } = opts
  const ticket = await prisma.chamado.create({
    data: {
      titulo: data.titulo,
      descricao: data.descricao,
      prioridade: data.prioridade ?? 'MEDIA',
      nivel: data.nivel ?? 'N1',
      status: 'ABERTO',
      servicoId: data.servicoId ?? null,
      setorId: data.setorId ?? null,
      clienteId: data.clienteId ?? null,
      contratoId: data.contratoId ?? null,
      responsavelId: data.responsavelId ?? null,
      organizacaoId: data.organizacaoId ?? null,
      criadoPorId: feitoPorId!, // exige auth
      // protocolo pode ser gerado aqui também:
      protocolo: `TCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    },
  })

  // histórico inicial
  await prisma.historicoStatusChamado.create({
    data: {
      chamadoId: ticket.id,
      de: null,
      para: 'ABERTO',
      porUsuarioId: feitoPorId ?? null,
      observacao: 'Abertura do chamado',
    },
  })

  return ticket
}

export async function getTicketById(prisma: Ctx, id: string, include?: TicketsListQuery['include']) {
  return prisma.chamado.findFirst({
    where: { id, deletadoEm: null },
    include: ticketInclude(include),
  })
}

export async function listTickets(prisma: Ctx, q: TicketsListQuery) {
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 20
  const skip = (page - 1) * pageSize
  const take = pageSize

  const where = buildWhere(q)
  const [total, items] = await Promise.all([
    prisma.chamado.count({ where }),
    prisma.chamado.findMany({
      where,
      orderBy: { [q.orderBy ?? 'criadoEm']: q.orderDir ?? 'desc' },
      skip,
      take,
      include: ticketInclude(q.include),
    }),
  ])

  return {
    total,
    page,
    pageSize,
    items,
  }
}

export async function updateTicket(prisma: Ctx, id: string, data: TicketUpdateInput, opts: { feitoPorId?: string }) {
  const { feitoPorId } = opts
  const before = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } })
  if (!before) throw Object.assign(new Error('Chamado não encontrado'), { code: 'P2025' })

  // se mudar status, registra histórico + timestamps
  const isStatusChange = data.status && data.status !== before.status

  const updated = await prisma.chamado.update({
    where: { id },
    data: {
      titulo: data.titulo ?? undefined,
      descricao: data.descricao ?? undefined,
      prioridade: data.prioridade ?? undefined,
      nivel: data.nivel ?? undefined,
      status: data.status ?? undefined,
      servicoId: data.servicoId === undefined ? undefined : data.servicoId,
      setorId: data.setorId === undefined ? undefined : data.setorId,
      clienteId: data.clienteId === undefined ? undefined : data.clienteId,
      contratoId: data.contratoId === undefined ? undefined : data.contratoId,
      responsavelId: data.responsavelId === undefined ? undefined : data.responsavelId,
      organizacaoId: data.organizacaoId === undefined ? undefined : data.organizacaoId,
      encerradoEm:
        data.status && (data.status === StatusChamado.ENCERRADO || data.status === StatusChamado.RESOLVIDO)
          ? new Date()
          : undefined,
    },
  })

  if (isStatusChange) {
    await prisma.historicoStatusChamado.create({
      data: {
        chamadoId: id,
        de: before.status,
        para: data.status as StatusChamado,
        porUsuarioId: feitoPorId ?? null,
        observacao: 'Atualização de status',
      },
    })
  }

  return updated
}

export async function softDeleteTicket(prisma: Ctx, id: string, opts: { feitoPorId?: string }) {
  const found = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } })
  if (!found) throw Object.assign(new Error('Chamado não encontrado'), { code: 'P2025' })

  const deleted = await prisma.chamado.update({
    where: { id },
    data: { deletadoEm: new Date() },
  })

  // auditoria opcional
  await prisma.auditoria.create({
    data: {
      feitoPorId: opts.feitoPorId ?? null,
      acao: 'DELETE_SOFT_CHAMADO',
      alvo: id,
      meta: { protocolo: found.protocolo },
    },
  })

  return deleted
}
