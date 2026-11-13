import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ApiError, isStaff, toSkipTake } from "../../hateoas";
import type { FieldError, Viewer } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { bestEffort } from "../../utils/best-effort";
import { notifyMany } from "../notifications/notify";
import { MODELO_CPA } from "./pesquisas.modelo";
import {
  ESCALA_MAX,
  ESCALA_MIN,
  ESCALA_NAO_SEI,
  PESQUISA_MIN_RESPOSTAS,
  aceitaRespostas,
  allowedTransitions,
  canEditPesquisa,
  canManagePesquisa,
  canViewResultados,
  cursoDoAluno,
  cursoNoPublico,
  lerCursos,
} from "./pesquisas.rules";
import type { StatusPesquisa, TipoPergunta } from "./pesquisas.rules";
import type {
  ParticipacaoCurso,
  PerguntaInput,
  PesquisaCopyInput,
  PesquisaCreateInput,
  PesquisaListQuery,
  PesquisaUpdateInput,
  RespostasInput,
  ResultadoPergunta,
  ResultadosPesquisa,
  ValorResposta,
} from "./pesquisas.types";

/*
 * ANONIMATO — como as respostas ficam desligadas do aluno:
 *  - `PesquisaParticipacao` guarda QUEM respondeu (só para impedir resposta dupla).
 *  - `PesquisaResposta` guarda O QUE foi respondido, sem usuarioId, sem data/hora e
 *    com id aleatório. As duas linhas nascem na mesma transação, mas nada as liga.
 *  - Resultados só aparecem a partir de PESQUISA_MIN_RESPOSTAS no recorte, e os
 *    textos abertos saem em ordem alfabética, não na ordem de envio.
 */

type Ctx = PrismaClient;

const NAO_ENCONTRADA = "Pesquisa não encontrada";
const TEXTO_MAX = 1000;

const INCLUDE = {
  perguntas: { orderBy: { ordem: "asc" as const } },
  _count: { select: { respostas: true } },
};

type PerguntaRow = {
  id: string;
  ordem: number;
  secao: string | null;
  texto: string;
  tipo: TipoPergunta | string;
  opcoes: unknown;
  obrigatoria: boolean;
};

type PesquisaRow = {
  id: string;
  status: string;
  cursos: unknown;
  fechaEm: Date | null;
  _count?: { respostas?: number };
};

/** Forma devolvida pela API: `cursos` como lista, total de respostas e se aceita respostas. */
function paraApi<T extends PesquisaRow, E extends object = object>(p: T, extra?: E) {
  const { _count, ...resto } = p;
  return {
    ...resto,
    status: p.status as StatusPesquisa,
    cursos: lerCursos(p.cursos),
    totalRespostas: _count?.respostas ?? 0,
    aceitaRespostas: aceitaRespostas({ status: p.status as StatusPesquisa, fechaEm: p.fechaEm }),
    ...(extra ?? ({} as E)),
  };
}

const jsonOuNulo = (lista?: string[] | null) => (lista?.length ? lista : Prisma.DbNull);

function linhasDePerguntas(perguntas: readonly PerguntaInput[]) {
  return perguntas.map((p, i) => ({
    ordem: i + 1,
    secao: p.secao?.trim() || null,
    texto: p.texto,
    tipo: p.tipo,
    opcoes: p.tipo === "MULTIPLA" && p.opcoes?.length ? p.opcoes : Prisma.DbNull,
    obrigatoria: p.tipo === "TEXTO" ? !!p.obrigatoria : p.obrigatoria,
  }));
}

async function exigir(prisma: Ctx, id: string) {
  const pesquisa = await prisma.pesquisa.findUnique({ where: { id }, include: INCLUDE });
  if (!pesquisa) throw new ApiError("not-found", NAO_ENCONTRADA);
  return pesquisa;
}

function exigirGestor(viewer: Viewer) {
  if (!canManagePesquisa(viewer)) throw new ApiError("forbidden", "Somente administradores gerenciam pesquisas");
}

async function dadosDoAluno(prisma: Ctx, usuarioId: string) {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { cursoNome: true, curso: true, turno: true },
  });
  return { curso: cursoDoAluno(u ?? {}), turno: u?.turno?.trim() || null };
}

const ALUNOS_ATIVOS = { papel: "USUARIO" as const, ativo: true, deletadoEm: null };

/** Alunos ativos por curso (o "curso cadastrado" de cada um). */
export async function contarAlunosPorCurso(prisma: Ctx): Promise<Map<string, number>> {
  const grupos = await prisma.usuario.groupBy({
    by: ["cursoNome", "curso"],
    where: ALUNOS_ATIVOS,
    _count: { _all: true },
  });
  const porCurso = new Map<string, number>();
  for (const g of grupos) {
    const curso = cursoDoAluno(g);
    porCurso.set(curso, (porCurso.get(curso) ?? 0) + g._count._all);
  }
  return porCurso;
}

/** Cursos com alunos ativos, para a CPA escolher o público. */
export async function listarCursos(prisma: Ctx, viewer: Viewer) {
  if (!canViewResultados(viewer)) throw new ApiError("forbidden", "Somente a equipe consulta os cursos");
  const porCurso = await contarAlunosPorCurso(prisma);
  return [...porCurso.entries()]
    .map(([curso, alunos]) => ({ curso, alunos }))
    .sort((a, b) => a.curso.localeCompare(b.curso, "pt-BR"));
}

/* ===================== Gestão (CPA) ===================== */

export async function createPesquisa(prisma: Ctx, data: PesquisaCreateInput, viewer: Viewer) {
  exigirGestor(viewer);
  const perguntas = data.perguntas ?? (data.modelo ? MODELO_CPA : []);

  const criada = await prisma.pesquisa.create({
    data: {
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      semestre: data.semestre,
      cursos: jsonOuNulo(data.cursos),
      fechaEm: data.fechaEm ?? null,
      criadoPorId: viewer.id,
      perguntas: { create: linhasDePerguntas(perguntas) },
    },
    select: { id: true },
  });

  await bestEffort(
    "auditoria-pesquisa-criar",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "pesquisa.criar", alvo: criada.id, meta: { semestre: data.semestre } }),
  );
  return paraApi(await exigir(prisma, criada.id));
}

export async function copyPesquisa(prisma: Ctx, id: string, data: PesquisaCopyInput, viewer: Viewer) {
  exigirGestor(viewer);
  const origem = await exigir(prisma, id);

  return createPesquisa(
    prisma,
    {
      titulo: data.titulo ?? origem.titulo.replace(origem.semestre, data.semestre),
      descricao: origem.descricao,
      semestre: data.semestre,
      cursos: lerCursos(origem.cursos),
      fechaEm: null,
      modelo: false,
      perguntas: (origem.perguntas ?? []).map((p) => ({
        secao: p.secao,
        texto: p.texto,
        tipo: p.tipo as TipoPergunta,
        opcoes: Array.isArray(p.opcoes) ? (p.opcoes as string[]) : null,
        obrigatoria: p.obrigatoria,
      })),
    },
    viewer,
  );
}

export async function updatePesquisa(prisma: Ctx, id: string, data: PesquisaUpdateInput, viewer: Viewer) {
  exigirGestor(viewer);
  const atual = await exigir(prisma, id);
  if (!canEditPesquisa(atual.status as StatusPesquisa, viewer)) {
    throw new ApiError(
      "conflict",
      "Pesquisa não pode mais ser editada",
      "Perguntas e público só mudam enquanto a pesquisa é rascunho. Para ajustar, copie-a para uma nova edição.",
    );
  }

  const { perguntas, cursos, ...campos } = data;
  await prisma.$transaction(async (tx) => {
    await tx.pesquisa.update({
      where: { id },
      data: { ...campos, ...(cursos !== undefined ? { cursos: jsonOuNulo(cursos) } : {}) },
      select: { id: true },
    });
    if (perguntas) {
      await tx.pesquisaPergunta.deleteMany({ where: { pesquisaId: id } });
      if (perguntas.length) {
        await tx.pesquisaPergunta.createMany({
          data: linhasDePerguntas(perguntas).map((p) => ({ ...p, pesquisaId: id })),
        });
      }
    }
  });
  return paraApi(await exigir(prisma, id));
}

export async function deletePesquisa(prisma: Ctx, id: string, viewer: Viewer) {
  exigirGestor(viewer);
  const atual = await exigir(prisma, id);
  if (atual.status !== "RASCUNHO") {
    throw new ApiError("conflict", "Só rascunhos podem ser excluídos", "Pesquisas abertas ou encerradas guardam respostas.");
  }
  await prisma.pesquisa.delete({ where: { id } });
  await bestEffort("auditoria-pesquisa-excluir", registrarAuditoria({ feitoPorId: viewer.id, acao: "pesquisa.excluir", alvo: id }));
}

async function avisarAlunos(prisma: Ctx, pesquisa: { id: string; titulo: string; cursos: unknown }) {
  const cursos = lerCursos(pesquisa.cursos);
  const alunos = await prisma.usuario.findMany({
    where: ALUNOS_ATIVOS,
    select: { id: true, cursoNome: true, curso: true },
  });
  const alvos = alunos.filter((a) => cursoNoPublico(cursos, cursoDoAluno(a))).map((a) => a.id);
  await notifyMany(prisma, alvos, {
    titulo: "Pesquisa institucional",
    mensagem: `"${pesquisa.titulo}" está aberta. Sua resposta é anônima e leva poucos minutos.`,
    tipo: "SISTEMA",
    meta: { pesquisaId: pesquisa.id },
  });
}

export async function transitionPesquisa(prisma: Ctx, id: string, para: StatusPesquisa, viewer: Viewer) {
  exigirGestor(viewer);
  const atual = await exigir(prisma, id);
  const de = atual.status as StatusPesquisa;

  if (!allowedTransitions(de, viewer).includes(para)) {
    throw new ApiError("conflict", "Mudança de status não permitida", `Não é possível ir de ${de} para ${para}.`);
  }
  if (para === "ABERTA" && !(atual.perguntas ?? []).length) {
    throw new ApiError("conflict", "Pesquisa sem perguntas", "Adicione ao menos uma pergunta antes de abrir.");
  }

  const agora = new Date();
  const prazoVencido = !!atual.fechaEm && atual.fechaEm.getTime() <= agora.getTime();
  await prisma.pesquisa.update({
    where: { id },
    data: {
      status: para,
      ...(para === "ABERTA" && de === "RASCUNHO" ? { abertaEm: agora } : {}),
      // Reabrir com o prazo antigo vencido não aceitaria respostas: limpa o prazo.
      ...(para === "ABERTA" && prazoVencido ? { fechaEm: null } : {}),
      encerradaEm: para === "ENCERRADA" ? agora : null,
    },
    select: { id: true },
  });

  await bestEffort(
    "auditoria-pesquisa-status",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "pesquisa.status", alvo: id, meta: { de, para } }),
  );
  if (de === "RASCUNHO" && para === "ABERTA") {
    await bestEffort("notificar-pesquisa-aberta", avisarAlunos(prisma, atual));
  }
  return paraApi(await exigir(prisma, id));
}

/* ===================== Consulta ===================== */

export async function listPesquisas(prisma: Ctx, query: PesquisaListQuery, viewer: Viewer) {
  if (isStaff(viewer)) {
    const where = {
      ...(query.semestre ? { semestre: query.semestre } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [total, items] = await Promise.all([
      prisma.pesquisa.count({ where }),
      prisma.pesquisa.findMany({
        where,
        orderBy: [{ semestre: "desc" }, { criadoEm: "desc" }],
        skip,
        take,
        include: { _count: { select: { respostas: true, perguntas: true } } },
      }),
    ]);
    return {
      total,
      page: query.page,
      size: query.size,
      items: items.map((p) => ({ ...paraApi(p), totalPerguntas: p._count.perguntas, respondida: undefined as boolean | undefined })),
    };
  }

  // Aluno: só as abertas para o curso dele, com a marca de "já respondi".
  const [abertas, aluno, participacoes] = await Promise.all([
    prisma.pesquisa.findMany({
      where: { status: "ABERTA" },
      orderBy: [{ semestre: "desc" }, { criadoEm: "desc" }],
      take: 100,
      include: { _count: { select: { perguntas: true } } },
    }),
    dadosDoAluno(prisma, viewer.id),
    prisma.pesquisaParticipacao.findMany({ where: { usuarioId: viewer.id }, select: { pesquisaId: true } }),
  ]);
  const respondidas = new Set(participacoes.map((p) => p.pesquisaId));
  const items = abertas
    .filter((p) => cursoNoPublico(lerCursos(p.cursos), aluno.curso))
    .map((p) => {
      const { _count, ...resto } = p;
      return {
        ...paraApi(resto),
        totalRespostas: 0, // o aluno não vê quantos responderam
        totalPerguntas: _count.perguntas,
        respondida: respondidas.has(p.id) as boolean | undefined,
      };
    });
  return { total: items.length, page: 0, size: Math.max(items.length, query.size), items };
}

export async function getPesquisa(prisma: Ctx, id: string, viewer: Viewer) {
  const pesquisa = await exigir(prisma, id);
  if (isStaff(viewer)) return { ...paraApi(pesquisa), respondida: undefined as boolean | undefined };

  const aluno = await dadosDoAluno(prisma, viewer.id);
  if (pesquisa.status === "RASCUNHO" || !cursoNoPublico(lerCursos(pesquisa.cursos), aluno.curso)) {
    throw new ApiError("not-found", NAO_ENCONTRADA);
  }
  const participou = await prisma.pesquisaParticipacao.findUnique({
    where: { pesquisaId_usuarioId: { pesquisaId: id, usuarioId: viewer.id } },
    select: { id: true },
  });
  return { ...paraApi(pesquisa), totalRespostas: 0, respondida: !!participou as boolean | undefined };
}

/* ===================== Responder (aluno) ===================== */

function erroDaResposta(p: PerguntaRow, valor: unknown): string | null {
  if (p.tipo === "ESCALA") {
    const ok = typeof valor === "number" && Number.isInteger(valor) && (valor === ESCALA_NAO_SEI || (valor >= ESCALA_MIN && valor <= ESCALA_MAX));
    return ok ? null : `Escolha uma nota de ${ESCALA_MIN} a ${ESCALA_MAX} ou "não sei"`;
  }
  if (p.tipo === "MULTIPLA") {
    const opcoes = Array.isArray(p.opcoes) ? (p.opcoes as unknown[]) : [];
    return typeof valor === "string" && opcoes.includes(valor) ? null : "Escolha uma das opções";
  }
  if (typeof valor !== "string") return "Resposta inválida";
  return valor.length > TEXTO_MAX ? `Máximo de ${TEXTO_MAX} caracteres` : null;
}

/** Confere as respostas contra as perguntas e devolve só o que vale guardar. */
export function validarRespostas(perguntas: readonly PerguntaRow[], respostas: RespostasInput): Record<string, ValorResposta> {
  const limpas: Record<string, ValorResposta> = {};
  const erros: FieldError[] = [];

  for (const p of perguntas) {
    const bruto = respostas[p.id];
    const valor = typeof bruto === "string" ? bruto.trim() : bruto;
    const vazio = valor === undefined || valor === null || valor === "";

    if (vazio) {
      if (p.obrigatoria) erros.push({ field: `respostas.${p.id}`, message: "Pergunta obrigatória" });
      continue;
    }
    const erro = erroDaResposta(p, valor);
    if (erro) erros.push({ field: `respostas.${p.id}`, message: erro });
    else limpas[p.id] = valor as ValorResposta;
  }

  if (erros.length) throw new ApiError("bad-request", "Respostas inválidas", undefined, erros);
  return limpas;
}

export async function responderPesquisa(prisma: Ctx, id: string, respostas: RespostasInput, viewer: Viewer) {
  if (viewer.role !== "USUARIO") throw new ApiError("forbidden", "Somente alunos respondem pesquisas");

  const pesquisa = await exigir(prisma, id);
  const aluno = await dadosDoAluno(prisma, viewer.id);
  if (pesquisa.status === "RASCUNHO" || !cursoNoPublico(lerCursos(pesquisa.cursos), aluno.curso)) {
    throw new ApiError("not-found", NAO_ENCONTRADA);
  }
  if (!aceitaRespostas({ status: pesquisa.status as StatusPesquisa, fechaEm: pesquisa.fechaEm })) {
    throw new ApiError("conflict", "Pesquisa encerrada", "O prazo para responder terminou.");
  }
  const limpas = validarRespostas(pesquisa.perguntas ?? [], respostas);

  try {
    await prisma.$transaction(async (tx) => {
      // A participação tem índice único: a segunda tentativa falha aqui e desfaz tudo.
      await tx.pesquisaParticipacao.create({ data: { pesquisaId: id, usuarioId: viewer.id } });
      await tx.pesquisaResposta.create({
        data: { pesquisaId: id, curso: aluno.curso, turno: aluno.turno, respostas: limpas },
      });
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      throw new ApiError("conflict", "Você já respondeu esta pesquisa");
    }
    throw e;
  }
  return { pesquisaId: id, respondida: true };
}

/* ===================== Resultados (CPA e coordenação) ===================== */

function agregarPergunta(p: PerguntaRow, valores: unknown[]): ResultadoPergunta {
  const base = { id: p.id, ordem: p.ordem, secao: p.secao, texto: p.texto, tipo: p.tipo as TipoPergunta };
  const dados = valores.filter((v) => v !== undefined && v !== null && v !== "");

  if (p.tipo === "ESCALA") {
    const distribuicao: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let naoSei = 0;
    let soma = 0;
    let n = 0;
    for (const v of dados) {
      if (v === ESCALA_NAO_SEI) naoSei++;
      else if (typeof v === "number" && String(v) in distribuicao) {
        distribuicao[String(v)]++;
        soma += v;
        n++;
      }
    }
    return { ...base, respostas: n + naoSei, media: n ? Math.round((soma / n) * 100) / 100 : null, distribuicao, naoSei };
  }

  if (p.tipo === "MULTIPLA") {
    const opcoes = (Array.isArray(p.opcoes) ? (p.opcoes as string[]) : []).map((opcao) => ({
      opcao,
      total: dados.filter((v) => v === opcao).length,
    }));
    return { ...base, respostas: opcoes.reduce((s, o) => s + o.total, 0), opcoes };
  }

  const textos = dados.filter((v): v is string => typeof v === "string").sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { ...base, respostas: textos.length, textos };
}

export async function resultadosPesquisa(
  prisma: Ctx,
  id: string,
  filtro: { curso?: string },
  viewer: Viewer,
): Promise<ResultadosPesquisa> {
  if (!canViewResultados(viewer)) throw new ApiError("forbidden", "Somente a equipe vê os resultados");
  const pesquisa = await exigir(prisma, id);
  const publico = lerCursos(pesquisa.cursos);

  const [todas, alunosPorCurso] = await Promise.all([
    prisma.pesquisaResposta.findMany({ where: { pesquisaId: id }, select: { curso: true, respostas: true } }),
    contarAlunosPorCurso(prisma),
  ]);

  // Participação por curso: quantos podiam responder e quantos responderam.
  const respondentes = new Map<string, number>();
  for (const r of todas) respondentes.set(r.curso, (respondentes.get(r.curso) ?? 0) + 1);
  const cursos = new Set([...respondentes.keys(), ...[...alunosPorCurso.keys()].filter((c) => cursoNoPublico(publico, c))]);
  const participacao: ParticipacaoCurso[] = [...cursos]
    .map((curso) => ({ curso, elegiveis: alunosPorCurso.get(curso) ?? 0, respondentes: respondentes.get(curso) ?? 0 }))
    .sort((a, b) => a.curso.localeCompare(b.curso, "pt-BR"));

  const recorte = filtro.curso ? todas.filter((r) => r.curso === filtro.curso) : todas;
  const elegiveis = filtro.curso ? participacao.filter((p) => p.curso === filtro.curso) : participacao;
  const suprimido = recorte.length < PESQUISA_MIN_RESPOSTAS;

  return {
    pesquisaId: id,
    curso: filtro.curso ?? null,
    minimo: PESQUISA_MIN_RESPOSTAS,
    totalRespostas: recorte.length,
    totalElegiveis: elegiveis.reduce((s, p) => s + p.elegiveis, 0),
    participacao,
    suprimido,
    perguntas: suprimido
      ? []
      : (pesquisa.perguntas ?? []).map((p) =>
          agregarPergunta(p, recorte.map((r) => (r.respostas as Record<string, unknown> | null)?.[p.id])),
        ),
  };
}
