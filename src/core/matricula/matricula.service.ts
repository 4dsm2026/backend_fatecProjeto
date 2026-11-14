import type { PrismaClient } from "@prisma/client";
import { ApiError, isStaff, toSkipTake } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { bestEffort } from "../../utils/best-effort";
import { alvosDaSecretaria } from "../notifications/alvos";
import { notifyMany } from "../notifications/notify";
import {
  MOTIVOS,
  MOTIVO_LEGIVEL,
  STATUS_ABERTOS,
  STATUS_LEGIVEL,
  TIPO_LEGIVEL,
  allowedTransitions,
  avaliarPedido,
  canRespond,
  canView,
  isFinal,
  requiresComment,
  semestreAtual,
  situacaoAposDeferir,
} from "./matricula.rules";
import type { Motivo, StatusSolicitacao, TipoSolicitacao } from "./matricula.rules";

type Ctx = PrismaClient;

const NAO_ENCONTRADA = "Solicitação não encontrada";
const CURSO_NAO_INFORMADO = "Curso não informado";

export type SolicitacaoCreateInput = {
  tipo: TipoSolicitacao;
  semestre?: string;
  motivo: Motivo;
  justificativa?: string | null;
};

export type SolicitacaoListQuery = {
  page: number;
  size: number;
  status?: StatusSolicitacao[];
  tipo?: TipoSolicitacao;
  semestre?: string;
  curso?: string;
  usuarioId?: string;
  abertos?: boolean;
  search?: string;
};

const ALUNO_SELECT = {
  id: true,
  nome: true,
  ra: true,
  emailPessoal: true,
  cursoNome: true,
  curso: true,
  turno: true,
  semestreAtual: true,
  situacaoAcademica: true,
} as const;

const INCLUDE_DETALHE = {
  usuario: { select: ALUNO_SELECT },
  decididoPor: { select: { id: true, nome: true } },
  historico: {
    orderBy: { criadoEm: "asc" as const },
    include: { autor: { select: { id: true, nome: true, papel: true } } },
  },
};

async function trancamentosDeferidos(prisma: Ctx, usuarioId: string): Promise<number> {
  return prisma.solicitacaoMatricula.count({ where: { usuarioId, tipo: "TRANCAMENTO", status: "DEFERIDO" } });
}

/** Detalhe + o que a Secretaria precisa saber para decidir (só para a equipe). */
async function carregar(prisma: Ctx, id: string, viewer: Viewer) {
  const s = await prisma.solicitacaoMatricula.findUnique({ where: { id }, include: INCLUDE_DETALHE });
  if (!s || !canView(viewer, s.usuarioId)) throw new ApiError("not-found", NAO_ENCONTRADA);
  if (!isStaff(viewer)) return { ...s, alertas: [] as string[] };

  const { alertas } = avaliarPedido(s.tipo as TipoSolicitacao, s.usuario ?? {}, await trancamentosDeferidos(prisma, s.usuarioId));
  return { ...s, alertas: isFinal(s.status as StatusSolicitacao) ? [] : alertas };
}

async function notificar(prisma: Ctx, alvos: string[], s: { id: string; status: string }, mensagem: string) {
  await bestEffort(
    "notificar-solicitacao-matricula",
    notifyMany(prisma, alvos, {
      titulo: "Matrícula",
      mensagem,
      tipo: "SISTEMA",
      meta: { solicitacaoMatriculaId: s.id, status: s.status },
    }),
  );
}

/** Situação do aluno para a tela "Matrícula": o que pode pedir agora e por quê. */
export async function situacaoDoAluno(prisma: Ctx, viewer: Viewer) {
  const [aluno, deferidos, aberta] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: viewer.id }, select: ALUNO_SELECT }),
    trancamentosDeferidos(prisma, viewer.id),
    prisma.solicitacaoMatricula.findFirst({
      where: { usuarioId: viewer.id, status: { in: [...STATUS_ABERTOS] } },
      select: { id: true, tipo: true, status: true },
    }),
  ]);
  const trancar = avaliarPedido("TRANCAMENTO", aluno ?? {}, deferidos);
  const cancelar = avaliarPedido("CANCELAMENTO", aluno ?? {}, deferidos);
  const motivoAberta = aberta ? "Você já tem um pedido em andamento." : null;

  return {
    situacaoAcademica: aluno?.situacaoAcademica ?? null,
    curso: aluno?.cursoNome?.trim() || aluno?.curso?.trim() || null,
    semestreAtual: aluno?.semestreAtual ?? null,
    semestreLetivo: semestreAtual(),
    trancamentosDeferidos: deferidos,
    pedidoEmAndamento: aberta,
    podeTrancar: !aberta && !trancar.bloqueio,
    podeCancelar: !aberta && !cancelar.bloqueio,
    bloqueioTrancamento: motivoAberta ?? trancar.bloqueio,
    bloqueioCancelamento: motivoAberta ?? cancelar.bloqueio,
    avisosTrancamento: trancar.alertas,
  };
}

export async function createSolicitacao(prisma: Ctx, data: SolicitacaoCreateInput, viewer: Viewer) {
  if (viewer.role !== "USUARIO") throw new ApiError("forbidden", "Somente o próprio aluno pede trancamento ou cancelamento");

  const situacao = await situacaoDoAluno(prisma, viewer);
  const bloqueio = data.tipo === "TRANCAMENTO" ? situacao.bloqueioTrancamento : situacao.bloqueioCancelamento;
  if (bloqueio) throw new ApiError("conflict", "Pedido não permitido", bloqueio);

  const criado = await prisma.solicitacaoMatricula.create({
    data: {
      usuarioId: viewer.id,
      tipo: data.tipo,
      semestre: data.semestre ?? situacao.semestreLetivo,
      motivo: data.motivo,
      justificativa: data.justificativa?.trim() || null,
      curso: situacao.curso ?? CURSO_NAO_INFORMADO,
      historico: { create: { de: null, para: "SOLICITADO", autorId: viewer.id, comentario: "Pedido enviado pelo aluno" } },
    },
    select: { id: true },
  });

  const s = await carregar(prisma, criado.id, viewer);
  await bestEffort(
    "auditoria-matricula-criar",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "matricula.solicitar", alvo: s.id, meta: { tipo: data.tipo, semestre: s.semestre } }),
  );
  await notificar(
    prisma,
    await alvosDaSecretaria(prisma),
    s,
    `${s.usuario?.nome ?? "Aluno"} pediu ${TIPO_LEGIVEL[data.tipo].toLowerCase()} (${s.semestre}).`,
  );
  return s;
}

export async function listSolicitacoes(prisma: Ctx, query: SolicitacaoListQuery, viewer: Viewer) {
  const staff = isStaff(viewer);
  let status: readonly StatusSolicitacao[] | undefined = query.status?.length ? query.status : undefined;
  if (!status && query.abertos) status = STATUS_ABERTOS;
  const search = staff ? query.search : undefined;

  // Aluno: sempre só os próprios. Equipe: todos, ou os de um aluno (ficha do aluno).
  let usuarioId: string | undefined = viewer.id;
  if (staff) usuarioId = query.usuarioId;

  const where = {
    ...(usuarioId ? { usuarioId } : {}),
    ...(status ? { status: { in: [...status] } } : {}),
    ...(query.tipo ? { tipo: query.tipo } : {}),
    ...(query.semestre ? { semestre: query.semestre } : {}),
    ...(staff && query.curso ? { curso: query.curso } : {}),
    ...(search
      ? { OR: [{ usuario: { nome: { contains: search } } }, { usuario: { ra: { contains: search } } }] }
      : {}),
  };
  const { skip, take } = toSkipTake(query);

  const [total, items] = await Promise.all([
    prisma.solicitacaoMatricula.count({ where }),
    prisma.solicitacaoMatricula.findMany({
      where,
      orderBy: [{ criadoEm: "desc" }],
      skip,
      take,
      include: { usuario: { select: { id: true, nome: true, ra: true } } },
    }),
  ]);
  return { total, page: query.page, size: query.size, items };
}

export async function getSolicitacao(prisma: Ctx, id: string, viewer: Viewer) {
  return carregar(prisma, id, viewer);
}

/** O aluno responde a pendência: atualiza a justificativa e devolve para análise. */
export async function responderPendencia(prisma: Ctx, id: string, justificativa: string, viewer: Viewer) {
  const atual = await carregar(prisma, id, viewer);
  if (!canRespond({ status: atual.status as StatusSolicitacao, ownerId: atual.usuarioId }, viewer)) {
    throw new ApiError("conflict", "Nada a responder", "Só é possível responder quando a Secretaria pede uma correção.");
  }
  await prisma.solicitacaoMatricula.update({
    where: { id },
    data: {
      justificativa,
      status: "EM_ANALISE",
      historico: { create: { de: "PENDENTE_ALUNO", para: "EM_ANALISE", autorId: viewer.id, comentario: justificativa } },
    },
    select: { id: true },
  });
  const s = await carregar(prisma, id, viewer);
  await notificar(prisma, await alvosDaSecretaria(prisma), s, `${s.usuario?.nome ?? "Aluno"} respondeu à pendência do pedido de ${TIPO_LEGIVEL[s.tipo as TipoSolicitacao].toLowerCase()}.`);
  return s;
}

export async function transitionSolicitacao(
  prisma: Ctx,
  id: string,
  data: { status: StatusSolicitacao; comentario?: string },
  viewer: Viewer,
) {
  const atual = await carregar(prisma, id, viewer);
  const de = atual.status as StatusSolicitacao;
  const para = data.status;
  const tipo = atual.tipo as TipoSolicitacao;

  if (!allowedTransitions({ status: de, ownerId: atual.usuarioId }, viewer).includes(para)) {
    throw new ApiError("conflict", "Mudança não permitida", `Não é possível ir de "${STATUS_LEGIVEL[de]}" para "${STATUS_LEGIVEL[para]}".`);
  }
  const staff = isStaff(viewer);
  if (staff && requiresComment(para) && !data.comentario) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, [{ field: "comentario", message: "Explique ao aluno o motivo" }]);
  }
  // Na hora de deferir, confere de novo o que bloqueia (o cadastro pode ter mudado).
  if (para === "DEFERIDO") {
    const outrosDeferidos = await trancamentosDeferidos(prisma, atual.usuarioId);
    const { bloqueio } = avaliarPedido(tipo, atual.usuario ?? {}, outrosDeferidos);
    if (bloqueio) throw new ApiError("conflict", "Não é possível deferir", bloqueio);
  }

  const agora = new Date();
  const decisao = para === "DEFERIDO" || para === "INDEFERIDO";
  await prisma.$transaction(async (tx) => {
    await tx.solicitacaoMatricula.update({
      where: { id },
      data: {
        status: para,
        ...(staff && data.comentario ? { orientacaoFatec: data.comentario } : {}),
        ...(decisao ? { decididoEm: agora, decididoPorId: viewer.id } : {}),
        historico: { create: { de, para, autorId: viewer.id, comentario: data.comentario ?? null } },
      },
      select: { id: true },
    });
    if (para === "DEFERIDO") {
      await tx.usuario.update({
        where: { id: atual.usuarioId },
        data: { situacaoAcademica: situacaoAposDeferir(tipo) },
        select: { id: true },
      });
    }
  });

  const s = await carregar(prisma, id, viewer);
  await bestEffort(
    "auditoria-matricula-status",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "matricula.status", alvo: id, meta: { tipo, de, para, alunoId: atual.usuarioId } }),
  );
  if (staff) {
    const texto = data.comentario ? `${STATUS_LEGIVEL[para]}: ${data.comentario}` : `${STATUS_LEGIVEL[para]}.`;
    await notificar(prisma, [atual.usuarioId], s, `${TIPO_LEGIVEL[tipo]} (${s.semestre}) — ${texto}`);
  } else {
    await notificar(prisma, await alvosDaSecretaria(prisma), s, `${s.usuario?.nome ?? "Aluno"} retirou o pedido de ${TIPO_LEGIVEL[tipo].toLowerCase()}.`);
  }
  return s;
}

/**
 * Painel da equipe: o que está na fila e, para o semestre, quantos trancamentos e
 * cancelamentos foram deferidos, por motivo e por curso (recorte de evasão).
 */
export async function resumoSolicitacoes(prisma: Ctx, query: { semestre?: string }, viewer: Viewer) {
  if (!isStaff(viewer)) throw new ApiError("forbidden", "Somente a equipe vê o resumo");
  const semestre = query.semestre ?? semestreAtual();

  const [abertos, porMotivo, porCurso] = await Promise.all([
    prisma.solicitacaoMatricula.groupBy({
      by: ["status"],
      where: { status: { in: [...STATUS_ABERTOS] } },
      _count: { _all: true },
    }),
    prisma.solicitacaoMatricula.groupBy({
      by: ["tipo", "motivo"],
      where: { semestre, status: "DEFERIDO" },
      _count: { _all: true },
    }),
    prisma.solicitacaoMatricula.groupBy({
      by: ["tipo", "curso"],
      where: { semestre, status: "DEFERIDO" },
      _count: { _all: true },
    }),
  ]);

  const contar = (tipo: TipoSolicitacao) =>
    porMotivo.filter((g) => g.tipo === tipo).reduce((s, g) => s + g._count._all, 0);

  return {
    semestre,
    emAberto: Object.fromEntries(abertos.map((g) => [g.status, g._count._all])),
    totalEmAberto: abertos.reduce((s, g) => s + g._count._all, 0),
    deferidos: { TRANCAMENTO: contar("TRANCAMENTO"), CANCELAMENTO: contar("CANCELAMENTO") },
    porMotivo: MOTIVOS.map((motivo) => ({
      motivo,
      rotulo: MOTIVO_LEGIVEL[motivo],
      TRANCAMENTO: porMotivo.find((g) => g.motivo === motivo && g.tipo === "TRANCAMENTO")?._count._all ?? 0,
      CANCELAMENTO: porMotivo.find((g) => g.motivo === motivo && g.tipo === "CANCELAMENTO")?._count._all ?? 0,
    })).filter((m) => m.TRANCAMENTO + m.CANCELAMENTO > 0),
    porCurso: [...new Set(porCurso.map((g) => g.curso))]
      .map((curso) => ({
        curso,
        TRANCAMENTO: porCurso.find((g) => g.curso === curso && g.tipo === "TRANCAMENTO")?._count._all ?? 0,
        CANCELAMENTO: porCurso.find((g) => g.curso === curso && g.tipo === "CANCELAMENTO")?._count._all ?? 0,
      }))
      .sort((a, b) => a.curso.localeCompare(b.curso, "pt-BR")),
  };
}
