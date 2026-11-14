import type { PrismaClient } from "@prisma/client";
import { ApiError, isStaff, toSkipTake } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { notifyMany } from "../notifications/notify";
import { bestEffort } from "../../utils/best-effort";
import {
  STATUS_ATIVOS,
  STATUS_PASSE_LEGIVEL,
  canTransition,
  canUpdatePasse,
  canViewPasse,
  isFinal,
  requiresComment,
} from "./passe-escolar.rules";
import type { StatusPasseEscolar } from "./passe-escolar.rules";
import type {
  PasseEscolarCreateInput,
  PasseEscolarExportQuery,
  PasseEscolarListQuery,
  PasseEscolarTransitionInput,
  PasseEscolarUpdateInput,
} from "./passe-escolar.types";

type Ctx = PrismaClient;

const EXPORT_MAX_LINHAS = 5000;

/** Campos do resumo (lista). Sem CPF e RG: esses só no detalhe e na exportação. */
const SELECT_RESUMO = {
  id: true,
  usuarioId: true,
  anoReferencia: true,
  tipo: true,
  modalidade: true,
  status: true,
  nomeCompleto: true,
  curso: true,
  periodo: true,
  mesConclusao: true,
  anoConclusao: true,
  cadastradoPortalEm: true,
  protocoloEmtu: true,
  encerradoEm: true,
  criadoEm: true,
  atualizadoEm: true,
  usuario: { select: { id: true, nome: true, ra: true } },
} as const;

const INCLUDE_DETALHE = {
  usuario: { select: { id: true, nome: true, ra: true, emailPessoal: true, curso: true, turno: true } },
  cadastradoPor: { select: { id: true, nome: true } },
  historico: {
    orderBy: { criadoEm: "asc" as const },
    include: { autor: { select: { id: true, nome: true, papel: true } } },
  },
} as const;

async function carregarDetalhe(prisma: Ctx, id: string) {
  return prisma.passeEscolar.findUnique({ where: { id }, include: INCLUDE_DETALHE });
}

async function exigirDetalhe(prisma: Ctx, id: string) {
  const passe = await carregarDetalhe(prisma, id);
  if (!passe) throw new ApiError("not-found", "Pedido de Passe Escolar não encontrado");
  return passe;
}

/* ===================== Notificações ===================== */

/**
 * Quem, na Fatec, cuida do Passe Escolar: os membros do setor "Secretaria".
 * Sem esse setor (ou sem membros), avisa os administradores.
 */
async function alvosDaSecretaria(prisma: Ctx): Promise<string[]> {
  const setor = await prisma.setor.findFirst({
    where: { nome: { contains: "Secretaria" } },
    select: { id: true },
    orderBy: { nome: "asc" },
  });
  if (setor) {
    const vinculos = await prisma.usuarioSetor.findMany({
      where: { setorId: setor.id, usuario: { ativo: true, deletadoEm: null } },
      select: { usuarioId: true },
    });
    const ids = vinculos.map((v) => v.usuarioId);
    if (ids.length) return ids;
  }
  const admins = await prisma.usuario.findMany({
    where: { papel: "ADMINISTRADOR", ativo: true, deletadoEm: null },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

async function notificar(
  prisma: Ctx,
  alvos: string[],
  passe: { id: string; status: StatusPasseEscolar; nomeCompleto: string },
  mensagem: string,
) {
  await bestEffort(
    "notificar-passe-escolar",
    notifyMany(prisma, alvos, {
      titulo: "Passe Escolar",
      mensagem,
      tipo: "SISTEMA",
      meta: { passeEscolarId: passe.id, status: passe.status },
    }),
  );
}

/* ===================== Casos de uso ===================== */

export async function createPasse(prisma: Ctx, data: PasseEscolarCreateInput, viewer: Viewer) {
  const anoReferencia = data.anoReferencia ?? new Date().getFullYear();

  const emAndamento = await prisma.passeEscolar.findFirst({
    where: { usuarioId: viewer.id, anoReferencia, status: { in: [...STATUS_ATIVOS] } },
    select: { id: true, status: true },
  });
  if (emAndamento) {
    throw new ApiError(
      "conflict",
      "Você já tem um pedido em andamento",
      `Já existe um pedido de ${anoReferencia} (${STATUS_PASSE_LEGIVEL[emAndamento.status as StatusPasseEscolar]}). Acompanhe ou cancele esse pedido antes de abrir outro.`,
    );
  }

  const dados = { ...data };
  delete dados.anoReferencia;
  const criado = await prisma.passeEscolar.create({
    data: {
      ...dados,
      anoReferencia,
      usuarioId: viewer.id,
      status: "SOLICITADO",
      historico: {
        create: { de: null, para: "SOLICITADO", autorId: viewer.id, comentario: "Pedido enviado pelo aluno" },
      },
    },
    select: { id: true },
  });

  const passe = await exigirDetalhe(prisma, criado.id);

  await bestEffort(
    "auditoria-passe-criado",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "passe-escolar.criar", alvo: passe.id, meta: { anoReferencia } }),
  );
  await notificar(
    prisma,
    await alvosDaSecretaria(prisma),
    passe,
    `${passe.nomeCompleto} pediu o cadastro do Passe Escolar ${anoReferencia}.`,
  );

  return passe;
}

function whereDaLista(query: PasseEscolarListQuery, viewer: Viewer) {
  const staff = isStaff(viewer);
  let status: readonly StatusPasseEscolar[] | undefined = query.status?.length ? query.status : undefined;
  if (!status && query.ativos) status = STATUS_ATIVOS;
  const search = staff && query.search ? query.search : undefined;

  return {
    ...(staff ? {} : { usuarioId: viewer.id }),
    ...(status ? { status: { in: [...status] } } : {}),
    ...(query.ano ? { anoReferencia: query.ano } : {}),
    ...(search
      ? {
          OR: [
            { nomeCompleto: { contains: search } },
            { usuario: { ra: { contains: search } } },
            { cpf: { contains: search.replace(/\D/g, "") || "\u0000" } },
          ],
        }
      : {}),
  };
}

/** Aluno vê os próprios pedidos; a equipe vê todos, com filtros. */
export async function listPasses(prisma: Ctx, query: PasseEscolarListQuery, viewer: Viewer) {
  const { skip, take } = toSkipTake(query);
  const where = whereDaLista(query, viewer);

  const [total, items] = await Promise.all([
    prisma.passeEscolar.count({ where }),
    prisma.passeEscolar.findMany({
      where,
      orderBy: [{ criadoEm: "desc" }],
      skip,
      take,
      select: SELECT_RESUMO,
    }),
  ]);

  return { total, page: query.page, size: query.size, items };
}

export async function getPasse(prisma: Ctx, id: string, viewer: Viewer) {
  const passe = await carregarDetalhe(prisma, id);
  if (!passe || !canViewPasse(viewer, passe.usuarioId)) {
    throw new ApiError("not-found", "Pedido de Passe Escolar não encontrado");
  }
  return passe;
}

/**
 * O aluno corrige os dados enquanto a Fatec não lançou no portal. Se o pedido estava
 * pendente, corrigir já devolve para a fila da secretaria (SOLICITADO).
 */
export async function updatePasse(prisma: Ctx, id: string, data: PasseEscolarUpdateInput, viewer: Viewer) {
  const atual = await exigirDetalhe(prisma, id);
  if (!canViewPasse(viewer, atual.usuarioId)) {
    throw new ApiError("not-found", "Pedido de Passe Escolar não encontrado");
  }
  const ctx = { status: atual.status as StatusPasseEscolar, ownerId: atual.usuarioId };
  if (!canUpdatePasse(ctx, viewer)) {
    throw new ApiError(
      "conflict",
      "Pedido não pode mais ser editado",
      "Os dados só podem ser alterados antes de a Fatec lançar o cadastro no portal da EMTU.",
    );
  }

  const modalidade = data.modalidade ?? atual.modalidade;
  const declaraBaixaRenda = data.declaraBaixaRenda ?? atual.declaraBaixaRenda;
  if (modalidade === "PASSE_LIVRE" && !declaraBaixaRenda) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, [
      { field: "declaraBaixaRenda", message: "O Passe Livre exige a declaração de renda" },
    ]);
  }

  const reenvio = ctx.status === "PENDENTE_ALUNO";
  await prisma.passeEscolar.update({
    where: { id },
    data: {
      ...data,
      ...(reenvio
        ? {
            status: "SOLICITADO",
            orientacaoFatec: null,
            historico: {
              create: {
                de: "PENDENTE_ALUNO",
                para: "SOLICITADO",
                autorId: viewer.id,
                comentario: "Dados corrigidos e reenviados pelo aluno",
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  const passe = await exigirDetalhe(prisma, id);
  if (reenvio) {
    await notificar(
      prisma,
      await alvosDaSecretaria(prisma),
      passe,
      `${passe.nomeCompleto} corrigiu os dados do Passe Escolar ${passe.anoReferencia}.`,
    );
  }
  return passe;
}

function textoParaOAluno(para: StatusPasseEscolar, comentario?: string): string {
  const base = STATUS_PASSE_LEGIVEL[para];
  return comentario ? `${base}: ${comentario}` : `${base}.`;
}

/** Muda a etapa do pedido. Quem pode mudar para o quê está em `passe-escolar.rules.ts`. */
export async function transitionPasse(
  prisma: Ctx,
  id: string,
  data: PasseEscolarTransitionInput,
  viewer: Viewer,
) {
  const atual = await exigirDetalhe(prisma, id);
  if (!canViewPasse(viewer, atual.usuarioId)) {
    throw new ApiError("not-found", "Pedido de Passe Escolar não encontrado");
  }
  const de = atual.status as StatusPasseEscolar;
  const para = data.status;
  const ctx = { status: de, ownerId: atual.usuarioId };

  if (!canTransition(ctx, viewer, para)) {
    throw new ApiError(
      "conflict",
      "Mudança de etapa não permitida",
      `Não é possível ir de "${STATUS_PASSE_LEGIVEL[de]}" para "${STATUS_PASSE_LEGIVEL[para]}" com o seu perfil.`,
    );
  }
  const staff = isStaff(viewer);
  if (staff && requiresComment(para) && !data.comentario) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, [
      { field: "comentario", message: "Explique ao aluno o motivo" },
    ]);
  }

  const agora = new Date();
  await prisma.passeEscolar.update({
    where: { id },
    data: {
      status: para,
      ...(staff && data.comentario ? { orientacaoFatec: data.comentario } : {}),
      ...(para === "CADASTRADO_PORTAL" ? { cadastradoPortalEm: agora, cadastradoPorId: viewer.id } : {}),
      ...(data.protocoloEmtu ? { protocoloEmtu: data.protocoloEmtu } : {}),
      ...(isFinal(para) ? { encerradoEm: agora } : {}),
      historico: { create: { de, para, autorId: viewer.id, comentario: data.comentario ?? null } },
    },
    select: { id: true },
  });

  const passe = await exigirDetalhe(prisma, id);

  await bestEffort(
    "auditoria-passe-status",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "passe-escolar.status", alvo: id, meta: { de, para } }),
  );

  if (staff) {
    await notificar(prisma, [passe.usuarioId], passe, `Passe Escolar ${passe.anoReferencia}: ${textoParaOAluno(para, data.comentario)}`);
  } else {
    await notificar(
      prisma,
      await alvosDaSecretaria(prisma),
      passe,
      `${passe.nomeCompleto} atualizou o Passe Escolar ${passe.anoReferencia}: ${STATUS_PASSE_LEGIVEL[para]}.`,
    );
  }

  return passe;
}

/* ===================== Exportação (secretaria) ===================== */

const MODALIDADE_LEGIVEL = { PASSE_LIVRE: "Passe Livre", MEIA_TARIFA: "Meia Tarifa" } as const;
const TIPO_LEGIVEL = { NOVO: "Novo", REVALIDACAO: "Revalidação" } as const;

function celulaCsv(valor: unknown): string {
  const texto = valor == null ? "" : String(valor);
  // Evita fórmulas ao abrir no Excel e escapa aspas.
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * CSV com as colunas que o Portal de Relacionamento pede, para a secretaria lançar
 * em lote. Separador `;` e BOM, que é o que o Excel em português abre direto.
 */
export async function exportPassesCsv(prisma: Ctx, query: PasseEscolarExportQuery, viewer: Viewer): Promise<string> {
  if (!isStaff(viewer)) throw new ApiError("forbidden", "Somente a equipe pode exportar");

  const linhas = await prisma.passeEscolar.findMany({
    where: {
      ...(query.ano ? { anoReferencia: query.ano } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
    },
    orderBy: [{ status: "asc" }, { nomeCompleto: "asc" }],
    take: EXPORT_MAX_LINHAS,
    include: { usuario: { select: { ra: true, emailPessoal: true } } },
  });

  const cabecalho = [
    "Nome completo", "RG", "CPF", "CEP", "Município", "Curso", "Período", "Conclusão (mês/ano)",
    "Modalidade", "Tipo", "Baixa renda", "Etapa", "RA", "E-mail", "Ano", "Pedido em", "Protocolo EMTU",
  ];
  const corpo = linhas.map((p) =>
    [
      p.nomeCompleto, p.rg, p.cpf, p.cep, p.municipioResidencia, p.curso, p.periodo,
      `${String(p.mesConclusao).padStart(2, "0")}/${p.anoConclusao}`,
      MODALIDADE_LEGIVEL[p.modalidade], TIPO_LEGIVEL[p.tipo], p.declaraBaixaRenda ? "Sim" : "Não",
      STATUS_PASSE_LEGIVEL[p.status as StatusPasseEscolar], p.usuario?.ra ?? "", p.usuario?.emailPessoal ?? "",
      p.anoReferencia, p.criadoEm.toISOString().slice(0, 10), p.protocoloEmtu ?? "",
    ].map(celulaCsv).join(";"),
  );

  await bestEffort(
    "auditoria-passe-exportar",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "passe-escolar.exportar", meta: { ...query, linhas: linhas.length } }),
  );

  return "﻿" + [cabecalho.map(celulaCsv).join(";"), ...corpo].join("\r\n") + "\r\n";
}
