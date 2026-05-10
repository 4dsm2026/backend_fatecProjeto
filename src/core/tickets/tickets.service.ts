import { PrismaClient, StatusChamado } from '@prisma/client';
import { randomBytes } from 'crypto';
import { TicketsListQuery, TicketCreateInput, TicketUpdateInput } from './tickets.types';
import { notifyMany } from '../notifications/notify';

type Ctx = PrismaClient;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/* ========================= helpers ========================= */

const ticketInclude = (include?: TicketsListQuery['include']) => {
  const base = {
    cliente: false, contrato: false, servico: false, setor: true,
    responsavel: false, criadoPor: false, historico: false,
  };
  if (!include) return base;
  const arr = Array.isArray(include) ? include : [include];
  for (const k of arr) (base as any)[k] = true;
  return base;
};

const buildWhere = (q: TicketsListQuery) => {
  const {
    search, status, nivel, prioridade,
    clienteId, contratoId, setorId, servicoId, responsavelId, organizacaoId,
    criadoDe, criadoAte, criadoPorId,
  } = q;

  return {
    deletadoEm: null,
    ...(criadoPorId   ? { criadoPorId }   : {}),
    ...(organizacaoId ? { organizacaoId } : {}),
    ...(clienteId     ? { clienteId }     : {}),
    ...(contratoId    ? { contratoId }    : {}),
    ...(setorId       ? { setorId }       : {}),
    ...(servicoId     ? { servicoId }     : {}),
    ...(responsavelId ? { responsavelId } : {}),
    ...(status    ? { status:    Array.isArray(status)    ? { in: status }    : status }    : {}),
    ...(nivel     ? { nivel:     Array.isArray(nivel)     ? { in: nivel }     : nivel }     : {}),
    ...(prioridade ? { prioridade: Array.isArray(prioridade) ? { in: prioridade } : prioridade } : {}),
    ...(criadoDe || criadoAte
      ? { criadoEm: { ...(criadoDe ? { gte: new Date(criadoDe) } : {}), ...(criadoAte ? { lte: new Date(criadoAte) } : {}) } }
      : {}),
    ...(search
      ? { OR: [
          { titulo:    { contains: search } },
          { descricao: { contains: search } },
          { protocolo: { contains: search } },
        ] }
      : {}),
  };
};

async function getUsuariosDoSetor(prisma: Ctx, setorId: string): Promise<string[]> {
  const vinculos = await prisma.usuarioSetor.findMany({
    where: { setorId, usuario: { ativo: true, deletadoEm: null } },
    select: { usuarioId: true },
  });
  return vinculos.map(v => v.usuarioId);
}

async function gerarProtocolo(prisma: Ctx, maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const protocolo = `TCK-${randomBytes(3).toString('hex').toUpperCase()}`;
    const exists = await prisma.chamado.findUnique({ where: { protocolo }, select: { id: true } });
    if (!exists) return protocolo;
  }
  throw new Error('Não foi possível gerar um protocolo único. Tente novamente.');
}

function isCatalogSlug(id?: string | null): boolean {
  return typeof id === 'string' && id.includes('-');
}

/* ========================= services ========================= */

export async function createTicket(prisma: Ctx, data: TicketCreateInput, opts: { feitoPorId?: string }) {
  const { feitoPorId } = opts;
  if (!feitoPorId) throw Object.assign(new Error('Não autenticado'), { code: 'UNAUTH' });

  const protocolo = await gerarProtocolo(prisma);

  const servicoIdIsSlug = isCatalogSlug(data.servicoId);
  const dbServicoid = servicoIdIsSlug ? null : (data.servicoId ?? null);

  const resolvedCatalogoServId = data.catalogoServicoId ?? (servicoIdIsSlug ? data.servicoId : null);
  const catId = data.catalogoCategoriaId ?? data.categoriaId;
  const resolvedCatalogoCatId = catId && isCatalogSlug(catId) ? catId : (data.catalogoCategoriaId ?? null);
  const resolvedCatNome = data.catalogoCategoriaNome ?? data.categoriaNome ?? null;

  let dbSetorId: string | null = data.setorId && !isCatalogSlug(data.setorId) ? data.setorId : null;
  if (!dbSetorId && data.setorProvavel) {
    const keyword = data.setorProvavel.split('/')[0].trim();
    const matched = await prisma.setor.findFirst({ where: { nome: { contains: keyword } }, select: { id: true } });
    if (matched) dbSetorId = matched.id;
  }

  const ticket = await prisma.chamado.create({
    data: {
      titulo:        data.titulo,
      descricao:     data.descricao,
      prioridade:    data.prioridade ?? 'MEDIA',
      nivel:         data.nivel ?? 'N1',
      status:        'ABERTO',
      servicoId:     dbServicoid,
      setorId:       dbSetorId,
      clienteId:     data.clienteId     ?? null,
      contratoId:    data.contratoId    ?? null,
      responsavelId: data.responsavelId ?? null,
      organizacaoId: data.organizacaoId ?? null,
      criadoPorId:   feitoPorId,
      protocolo,
      catalogoServicoId:     resolvedCatalogoServId ?? null,
      catalogoCategoriaId:   resolvedCatalogoCatId ?? null,
      catalogoCategoriaNome: resolvedCatNome,
      setorProvavel:         data.setorProvavel  ?? null,
      dadosAcademicos:       (data.dadosAcademicos  as any) ?? null,
      camposEspecificos:     (data.camposEspecificos as any) ?? null,
      origem:                data.origem           ?? null,
      precisaAcaoDoAluno:    data.precisaAcaoDoAluno ?? false,
    },
  });

  await prisma.historicoStatusChamado.create({
    data: {
      chamadoId:   ticket.id,
      de:          null,
      para:        'ABERTO',
      porUsuarioId: feitoPorId,
      observacao:  'Abertura do chamado',
    },
  });

  const alvos = new Set<string>([feitoPorId]);
  if (ticket.responsavelId) alvos.add(ticket.responsavelId);
  if (ticket.setorId) {
    for (const u of await getUsuariosDoSetor(prisma, ticket.setorId)) alvos.add(u);
  }

  notifyMany(prisma, Array.from(alvos), {
    titulo: 'Chamado criado',
    mensagem: `Chamado ${protocolo} criado.`,
    tipo: 'CHAMADO_CRIADO',
    chamadoId: ticket.id,
    organizacaoId: ticket.organizacaoId ?? null,
  }).catch(() => {});

  return prisma.chamado.findFirst({
    where: { id: ticket.id },
    include: ticketInclude(['servico', 'criadoPor']),
  });
}

export async function getTicketById(prisma: Ctx, id: string, include?: TicketsListQuery['include']) {
  const baseInclude: any = ticketInclude(include);
  baseInclude.mensagens = {
    include: { autor: { select: { id: true, nome: true, emailPessoal: true } } },
    orderBy: { criadoEm: 'asc' },
  };
  baseInclude.historico = {
    include: { porUsuario: { select: { id: true, nome: true, emailPessoal: true } } },
    orderBy: { criadoEm: 'desc' },
  };
  return prisma.chamado.findFirst({ where: { id, deletadoEm: null }, include: baseInclude });
}

export async function listTickets(prisma: Ctx, q: TicketsListQuery) {
  const page     = q.page ?? 1;
  const pageSize = Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const skip     = (page - 1) * pageSize;
  const where    = buildWhere(q);

  const [total, items] = await Promise.all([
    prisma.chamado.count({ where }),
    prisma.chamado.findMany({
      where,
      orderBy: { [q.orderBy ?? 'criadoEm']: q.orderDir ?? 'desc' },
      skip,
      take: pageSize,
      include: ticketInclude(q.include),
    }),
  ]);

  return { total, page, pageSize, items };
}

export async function updateTicket(prisma: Ctx, id: string, data: TicketUpdateInput, opts: { feitoPorId?: string }) {
  const { feitoPorId } = opts;
  const before = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } });
  if (!before) throw Object.assign(new Error('Chamado não encontrado'), { code: 'P2025' });

  const isStatusChange   = !!data.status && data.status !== before.status;
  const oldResponsavelId = before.responsavelId;

  const updated = await prisma.chamado.update({
    where: { id },
    data: {
      titulo:    data.titulo    ?? undefined,
      descricao: data.descricao ?? undefined,
      prioridade: data.prioridade ?? undefined,
      nivel:      data.nivel      ?? undefined,
      status:     data.status     ?? undefined,
      servicoId:     data.servicoId     === undefined ? undefined : data.servicoId,
      setorId:       data.setorId       === undefined ? undefined : data.setorId,
      clienteId:     data.clienteId     === undefined ? undefined : data.clienteId,
      contratoId:    data.contratoId    === undefined ? undefined : data.contratoId,
      responsavelId: data.responsavelId === undefined ? undefined : data.responsavelId,
      organizacaoId: data.organizacaoId === undefined ? undefined : data.organizacaoId,
      precisaAcaoDoAluno: data.precisaAcaoDoAluno ?? undefined,
      observacaoInterna:  (data as any).observacaoInterna  ?? undefined,
      slaHoras:    (data as any).slaHoras    ?? undefined,
      slaDias:     (data as any).slaDias     ?? undefined,
      vencimentoSla: (data as any).vencimentoSla ? new Date((data as any).vencimentoSla) : undefined,
      encerradoEm:
        data.status &&
        (data.status === StatusChamado.ENCERRADO || data.status === StatusChamado.RESOLVIDO)
          ? new Date()
          : undefined,
    },
  });

  if (isStatusChange) {
    const [, alvoInfo] = await Promise.all([
      prisma.historicoStatusChamado.create({
        data: {
          chamadoId:    id,
          de:           before.status,
          para:         data.status as StatusChamado,
          porUsuarioId: feitoPorId ?? null,
          observacao:   'Atualização de status',
        },
      }),
      prisma.chamado.findUnique({
        where: { id },
        select: { criadoPorId: true, responsavelId: true, protocolo: true, organizacaoId: true, setorId: true },
      }),
    ]);

    const alvos = new Set<string>();
    if (alvoInfo?.criadoPorId)   alvos.add(alvoInfo.criadoPorId);
    if (alvoInfo?.responsavelId) alvos.add(alvoInfo.responsavelId);
    if (alvoInfo?.setorId && data.status === StatusChamado.EM_ATENDIMENTO) {
      for (const u of await getUsuariosDoSetor(prisma, alvoInfo.setorId)) alvos.add(u);
    }
    notifyMany(prisma, Array.from(alvos), {
      titulo: 'Status atualizado',
      mensagem: `Chamado ${alvoInfo?.protocolo ?? id} mudou para ${data.status}.`,
      tipo: 'STATUS_ALTERADO',
      chamadoId: id,
      organizacaoId: alvoInfo?.organizacaoId ?? null,
    }).catch(() => {});
  }

  if (data.responsavelId !== undefined && data.responsavelId !== oldResponsavelId && data.responsavelId) {
    const alvoInfo = await prisma.chamado.findUnique({ where: { id }, select: { protocolo: true, organizacaoId: true } });
    notifyMany(prisma, [data.responsavelId], {
      titulo: 'Chamado atribuído',
      mensagem: `Você foi atribuído ao chamado ${alvoInfo?.protocolo ?? id}.`,
      tipo: 'CHAMADO_ATRIBUIDO',
      chamadoId: id,
      organizacaoId: alvoInfo?.organizacaoId ?? null,
    }).catch(() => {});
  }

  return updated;
}

export async function softDeleteTicket(prisma: Ctx, id: string, opts: { feitoPorId?: string }) {
  const found = await prisma.chamado.findFirst({ where: { id, deletadoEm: null } });
  if (!found) throw Object.assign(new Error('Chamado não encontrado'), { code: 'P2025' });

  const deleted = await prisma.chamado.update({
    where: { id },
    data: { deletadoEm: new Date() },
  });

  prisma.auditoria.create({
    data: { feitoPorId: opts.feitoPorId ?? null, acao: 'DELETE_SOFT_CHAMADO', alvo: id, meta: { protocolo: found.protocolo } },
  }).catch(() => {});

  return deleted;
}

/* ========================= stats ========================= */

export async function statsTickets(
  prisma: Ctx,
  opts: { organizacaoId?: string } = {},
) {
  const base = {
    deletadoEm: null,
    ...(opts.organizacaoId ? { organizacaoId: opts.organizacaoId } : {}),
  };

  // Contagens por status em paralelo
  const [
    nAberto,
    nEmAtendimento,
    nAguardando,
    nResolvido,
    nEncerrado,
  ] = await Promise.all([
    prisma.chamado.count({ where: { ...base, status: 'ABERTO' } }),
    prisma.chamado.count({ where: { ...base, status: 'EM_ATENDIMENTO' } }),
    prisma.chamado.count({ where: { ...base, status: 'AGUARDANDO_USUARIO' } }),
    prisma.chamado.count({ where: { ...base, status: 'RESOLVIDO' } }),
    prisma.chamado.count({ where: { ...base, status: 'ENCERRADO' } }),
  ]);

  const total = nAberto + nEmAtendimento + nAguardando + nResolvido + nEncerrado;
  const totalResolvidos = nResolvido + nEncerrado;
  const pctResolvidos = total > 0 ? Math.round((totalResolvidos / total) * 100) : 0;

  // Chamados encerrados com tempo de resolução
  const encerrados = await prisma.chamado.findMany({
    where: { ...base, status: { in: ['RESOLVIDO', 'ENCERRADO'] }, encerradoEm: { not: null } },
    select: { criadoEm: true, encerradoEm: true, vencimentoSla: true },
  });

  let ttrMedioHoras = 0;
  let slaMedioDias  = 0;
  let pctNoPrazo    = 0;

  if (encerrados.length > 0) {
    const ttrsMs = encerrados.map(e => e.encerradoEm!.getTime() - e.criadoEm.getTime());
    const somaMs = ttrsMs.reduce((a, b) => a + b, 0);
    ttrMedioHoras = somaMs / encerrados.length / 3_600_000;
    slaMedioDias  = ttrMedioHoras / 24;

    const comSla = encerrados.filter(e => e.vencimentoSla != null);
    if (comSla.length > 0) {
      const noPrazo = comSla.filter(e => e.encerradoEm! <= e.vencimentoSla!).length;
      pctNoPrazo = Math.round((noPrazo / comSla.length) * 100);
    }
  }

  // Agregações por setor
  const setorGroups = await prisma.chamado.groupBy({
    by: ['setorId'],
    where: base,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  const setorIds = setorGroups.map(g => g.setorId).filter(Boolean) as string[];
  const setoresDb = setorIds.length
    ? await prisma.setor.findMany({ where: { id: { in: setorIds } }, select: { id: true, nome: true } })
    : [];
  const setorNomeMap = Object.fromEntries(setoresDb.map(s => [s.id, s.nome]));
  const porSetor = setorGroups.map(g => ({
    setor: g.setorId ? (setorNomeMap[g.setorId] ?? g.setorId) : '—',
    total: g._count.id,
  }));

  // Agregações por responsável
  const respGroups = await prisma.chamado.groupBy({
    by: ['responsavelId'],
    where: base,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  const respIds = respGroups.map(g => g.responsavelId).filter(Boolean) as string[];
  const respsDb = respIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })
    : [];
  const respNomeMap = Object.fromEntries(respsDb.map(r => [r.id, r.nome]));
  const porResponsavel = respGroups.map(g => ({
    responsavel: g.responsavelId ? (respNomeMap[g.responsavelId] ?? '—') : '—',
    total: g._count.id,
  }));

  // Agregações por nível e prioridade
  const [nivelGroups, prioGroups] = await Promise.all([
    prisma.chamado.groupBy({ by: ['nivel'],     where: base, _count: { id: true } }),
    prisma.chamado.groupBy({ by: ['prioridade'], where: base, _count: { id: true } }),
  ]);

  const porNivel     = Object.fromEntries(nivelGroups.map(g => [g.nivel,     g._count.id]));
  const porPrioridade = Object.fromEntries(prioGroups.map(g => [g.prioridade, g._count.id]));

  // Chamados criados nos últimos 7 dias (por dia)
  const hoje = new Date();
  const ha7  = new Date(hoje);
  ha7.setDate(ha7.getDate() - 6);
  ha7.setHours(0, 0, 0, 0);

  const recentes = await prisma.chamado.findMany({
    where: { ...base, criadoEm: { gte: ha7 } },
    select: { criadoEm: true },
  });

  const porDia: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(ha7);
    d.setDate(d.getDate() + i);
    porDia[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of recentes) {
    const key = r.criadoEm.toISOString().slice(0, 10);
    if (key in porDia) porDia[key]++;
  }
  const tendencia7dias = Object.entries(porDia).map(([dia, total]) => ({ dia, total }));

  return {
    total,
    porStatus: {
      ABERTO:             nAberto,
      EM_ATENDIMENTO:     nEmAtendimento,
      AGUARDANDO_USUARIO: nAguardando,
      RESOLVIDO:          nResolvido,
      ENCERRADO:          nEncerrado,
    },
    porNivel,
    porPrioridade,
    porSetor,
    porResponsavel,
    ttrMedioHoras:  +ttrMedioHoras.toFixed(2),
    slaMedioDias:   +slaMedioDias.toFixed(2),
    pctNoPrazo,
    pctResolvidos,
    tendencia7dias,
    atualizadoEm: new Date().toISOString(),
  };
}
