import type { PrismaClient } from "@prisma/client";
import { ApiError, isAdmin } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { bestEffort } from "../../utils/best-effort";
import { notifyMany } from "../notifications/notify";
import { enviarEmails, linkDoChamado, type Destinatario } from "./roteamento.emails";
import { deveEscalonar, emailValido, escolherRegra, type NivelContato } from "./roteamento.rules";

type Ctx = PrismaClient;

/* ===================== Escolher o setor ===================== */

export interface Destino {
  setorId: string | null;
  setorCopiaId: string | null;
  regraId: string | null;
  motivo: string;
}

/** Setor padrão quando nada combina: a Secretaria; sem ela, o primeiro setor. */
async function setorPadrao(prisma: Ctx) {
  return (
    (await prisma.setor.findFirst({ where: { nome: { contains: "Secretaria" } }, orderBy: { nome: "asc" }, select: { id: true, nome: true } })) ??
    (await prisma.setor.findFirst({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }))
  );
}

/** Setor cujo nome parece com o "setor provável" do serviço (comportamento antigo, #114). */
async function setorPorNome(prisma: Ctx, setorProvavel?: string | null) {
  const chave = setorProvavel?.split("/")[0].trim();
  if (!chave) return null;
  const direto = await prisma.setor.findFirst({ where: { nome: { contains: chave } }, select: { id: true, nome: true } });
  if (direto) return direto;
  const kw = chave.toLowerCase();
  const todos = (await prisma.setor.findMany({ select: { id: true, nome: true } })) ?? [];
  return todos.find((s) => kw.includes(s.nome.toLowerCase()) || s.nome.toLowerCase().includes(kw)) ?? null;
}

/**
 * Para onde vai um chamado. Ordem: setor escolhido explicitamente (equipe) →
 * regra de roteamento → nome parecido com o "setor provável" → Secretaria.
 */
export async function rotearChamado(
  prisma: Ctx,
  dados: { setorIdExplicito?: string | null; servico?: string | null; categoria?: string | null; setorProvavel?: string | null },
): Promise<Destino> {
  if (dados.setorIdExplicito) {
    return { setorId: dados.setorIdExplicito, setorCopiaId: null, regraId: null, motivo: "Setor escolhido na abertura" };
  }
  if (dados.servico || dados.categoria) {
    const regras = (await prisma.regraRoteamento.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" } })) ?? [];
    const regra = escolherRegra(regras, { servico: dados.servico, categoria: dados.categoria });
    if (regra) return { setorId: regra.setorId, setorCopiaId: regra.setorCopiaId, regraId: regra.id, motivo: `Regra: ${regra.nome}`.slice(0, 255) };
  }
  const porNome = await setorPorNome(prisma, dados.setorProvavel);
  if (porNome) return { setorId: porNome.id, setorCopiaId: null, regraId: null, motivo: `Setor provável do serviço: ${porNome.nome}`.slice(0, 255) };
  const padrao = await setorPadrao(prisma);
  return { setorId: padrao?.id ?? null, setorCopiaId: null, regraId: null, motivo: padrao ? `Nenhuma regra combinou: setor padrão (${padrao.nome})` : "Nenhum setor cadastrado" };
}

/* ===================== Quem recebe ===================== */

type ContatoComUsuario = {
  nivel: NivelContato;
  usuarioId: string | null;
  email: string | null;
  nome: string | null;
  usuario: { id: string; nome: string; emailEducacional: string | null; emailPessoal: string; ativo: boolean; deletadoEm: Date | null } | null;
};

const SELECT_CONTATO = {
  nivel: true,
  usuarioId: true,
  email: true,
  nome: true,
  usuario: { select: { id: true, nome: true, emailEducacional: true, emailPessoal: true, ativo: true, deletadoEm: true } },
} as const;

async function contatos(prisma: Ctx, setorId: string, niveis: NivelContato[]): Promise<ContatoComUsuario[]> {
  return ((await prisma.setorContato.findMany({ where: { setorId, nivel: { in: niveis } }, select: SELECT_CONTATO })) ?? []) as ContatoComUsuario[];
}

/** Junta os contatos em quem recebe aviso no sistema (usuários) e quem recebe e-mail. */
function destinatarios(lista: ContatoComUsuario[], emCopia: (c: ContatoComUsuario) => boolean) {
  const usuarioIds = new Set<string>();
  const porEmail = new Map<string, Destinatario>();
  for (const c of lista) {
    if (c.usuario && (!c.usuario.ativo || c.usuario.deletadoEm)) continue; // usuário desativado não recebe
    const email = (c.usuario ? c.usuario.emailEducacional || c.usuario.emailPessoal : c.email)?.trim().toLowerCase();
    if (c.usuario) usuarioIds.add(c.usuario.id);
    if (!email || !emailValido(email)) continue;
    const anterior = porEmail.get(email);
    // Se a mesma pessoa aparece como atendente e em cópia, vale "atendente".
    if (!anterior || (anterior.emCopia && !emCopia(c))) {
      porEmail.set(email, { email, nome: c.usuario?.nome ?? c.nome ?? email, emCopia: emCopia(c) });
    }
  }
  return { usuarioIds: [...usuarioIds], emails: [...porEmail.values()] };
}

/**
 * Quem é avisado quando o chamado chega: o 1º nível do setor (atende), a cópia do
 * setor e o 1º nível do setor em cópia da regra (esses dois marcados "em cópia").
 */
export async function quemRecebeAoChegar(prisma: Ctx, setorId: string, setorCopiaId: string | null) {
  const doSetor = await contatos(prisma, setorId, ["PRIMEIRO", "COPIA"]);
  const daCopia = setorCopiaId && setorCopiaId !== setorId ? await contatos(prisma, setorCopiaId, ["PRIMEIRO"]) : [];
  const emCopia = new Set<ContatoComUsuario>([...doSetor.filter((c) => c.nivel === "COPIA"), ...daCopia]);
  return destinatarios([...doSetor, ...daCopia], (c) => emCopia.has(c));
}

/* ===================== Avisar ===================== */

export interface ChamadoParaAviso {
  id: string;
  protocolo: string | null;
  titulo: string;
  prioridade: string;
  setorId: string | null;
  organizacaoId: string | null;
  catalogoCategoriaNome?: string | null;
  servicoNome?: string | null;
  solicitante?: string | null;
}

async function nomeDoSetor(prisma: Ctx, setorId: string): Promise<string> {
  return (await prisma.setor.findUnique({ where: { id: setorId }, select: { nome: true } }))?.nome ?? "setor";
}

function variaveis(chamado: ChamadoParaAviso, setor: string): Record<string, string> {
  return {
    "chamado.protocolo": chamado.protocolo ?? "sem protocolo",
    "chamado.titulo": chamado.titulo,
    "chamado.prioridade": chamado.prioridade,
    "chamado.servico": chamado.servicoNome ?? chamado.catalogoCategoriaNome ?? "—",
    "chamado.solicitante": chamado.solicitante ?? "—",
    "setor.nome": setor,
    "links.chamadoAdmin": linkDoChamado(chamado.id),
  };
}

/**
 * Avisa a hierarquia do setor que o chamado chegou: e-mail para o 1º nível e
 * cópias (usuários e e-mails avulsos) e aviso no sistema para os usuários.
 * Nunca lança: falha de e-mail não pode impedir a abertura do chamado.
 */
export async function avisarChegada(prisma: Ctx, chamado: ChamadoParaAviso, setorCopiaId: string | null, jaAvisados: Set<string> = new Set()) {
  if (!chamado.setorId) return { emails: 0 };
  try {
    const setor = await nomeDoSetor(prisma, chamado.setorId);
    const quem = await quemRecebeAoChegar(prisma, chamado.setorId, setorCopiaId);
    const novos = quem.usuarioIds.filter((id) => !jaAvisados.has(id));
    await bestEffort(
      "notificar-roteamento",
      notifyMany(prisma, novos, {
        titulo: `Novo chamado para ${setor}`,
        mensagem: `Chamado ${chamado.protocolo ?? ""} chegou em ${setor}.`,
        tipo: "CHAMADO_CRIADO",
        chamadoId: chamado.id,
        organizacaoId: chamado.organizacaoId,
      }),
    );
    const emails = await enviarEmails(prisma, "TICKET_ROUTED", quem.emails, variaveis(chamado, setor));
    return { emails };
  } catch (e) {
    console.error("[roteamento] falha ao avisar a chegada:", e);
    return { emails: 0 };
  }
}

/* ===================== Escalonar ===================== */

/**
 * Chamados ainda "Abertos" e sem responsável depois do prazo do setor: avisa o 2º
 * nível (uma vez só) e marca `escalonadoEm`. Roda a cada 15 minutos.
 */
export async function escalonarAtrasados(prisma: Ctx, agora: Date = new Date()) {
  const candidatos = await prisma.chamado.findMany({
    where: {
      status: "ABERTO",
      responsavelId: null,
      escalonadoEm: null,
      deletadoEm: null,
      arquivadoEm: null,
      setor: { prazoEscalonamentoHoras: { not: null } },
    },
    select: {
      id: true,
      protocolo: true,
      titulo: true,
      prioridade: true,
      status: true,
      responsavelId: true,
      escalonadoEm: true,
      criadoEm: true,
      organizacaoId: true,
      setorId: true,
      catalogoCategoriaNome: true,
      setor: { select: { nome: true, prazoEscalonamentoHoras: true } },
    },
    take: 200,
  });

  let escalonados = 0;
  for (const c of candidatos) {
    if (!c.setorId || !deveEscalonar(c, c.setor?.prazoEscalonamentoHoras ?? null, agora)) continue;
    // Marca primeiro (só se ainda não marcado): duas instâncias não avisam em dobro.
    const marcado = await prisma.chamado.updateMany({ where: { id: c.id, escalonadoEm: null }, data: { escalonadoEm: agora } });
    if (marcado.count !== 1) continue;

    const segundo = destinatarios(await contatos(prisma, c.setorId, ["SEGUNDO"]), () => false);
    await bestEffort(
      "notificar-escalonamento",
      notifyMany(prisma, segundo.usuarioIds, {
        titulo: "Chamado sem atendimento",
        mensagem: `Chamado ${c.protocolo ?? ""} está em ${c.setor?.nome} sem ninguém assumir há ${c.setor?.prazoEscalonamentoHoras} h úteis.`,
        tipo: "CHAMADO_ATUALIZADO",
        chamadoId: c.id,
        organizacaoId: c.organizacaoId,
      }),
    );
    const vars = { ...variaveis(c, c.setor?.nome ?? "setor"), "prazo.horas": String(c.setor?.prazoEscalonamentoHoras ?? "") };
    await enviarEmails(prisma, "TICKET_ESCALATED", segundo.emails, vars);
    await bestEffort(
      "auditoria-escalonamento",
      registrarAuditoria({ acao: "chamado.escalonar", alvo: c.id, meta: { setorId: c.setorId, avisados: segundo.emails.length + segundo.usuarioIds.length } }),
    );
    escalonados++;
  }
  return { verificados: candidatos.length, escalonados };
}

/* ===================== Administração ===================== */

function exigirAdmin(viewer: Viewer) {
  if (!isAdmin(viewer)) throw new ApiError("forbidden", "Somente administradores configuram o roteamento");
}

export type RegraInput = {
  nome: string;
  ordem?: number;
  ativo?: boolean;
  categoriaChave?: string | null;
  servicoChave?: string | null;
  setorId: string;
  setorCopiaId?: string | null;
};

const INCLUDE_REGRA = { setor: { select: { id: true, nome: true } }, setorCopia: { select: { id: true, nome: true } } } as const;

async function exigirSetores(prisma: Ctx, ids: (string | null | undefined)[]) {
  const unicos = [...new Set(ids.filter(Boolean) as string[])];
  const achados = await prisma.setor.count({ where: { id: { in: unicos } } });
  if (achados !== unicos.length) throw new ApiError("bad-request", "Setor não encontrado", "Escolha setores que existem.");
}

export async function listarRegras(prisma: Ctx, viewer: Viewer) {
  exigirAdmin(viewer);
  return prisma.regraRoteamento.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }], include: INCLUDE_REGRA });
}

export async function criarRegra(prisma: Ctx, dados: RegraInput, viewer: Viewer) {
  exigirAdmin(viewer);
  await exigirSetores(prisma, [dados.setorId, dados.setorCopiaId]);
  const regra = await prisma.regraRoteamento.create({ data: dados, include: INCLUDE_REGRA });
  await bestEffort("auditoria-regra", registrarAuditoria({ feitoPorId: viewer.id, acao: "roteamento.regra.criar", alvo: regra.id, meta: dados }));
  return regra;
}

export async function atualizarRegra(prisma: Ctx, id: string, dados: Partial<RegraInput>, viewer: Viewer) {
  exigirAdmin(viewer);
  if (!(await prisma.regraRoteamento.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError("not-found", "Regra não encontrada");
  await exigirSetores(prisma, [dados.setorId, dados.setorCopiaId]);
  const regra = await prisma.regraRoteamento.update({ where: { id }, data: dados, include: INCLUDE_REGRA });
  await bestEffort("auditoria-regra", registrarAuditoria({ feitoPorId: viewer.id, acao: "roteamento.regra.editar", alvo: id, meta: dados }));
  return regra;
}

export async function excluirRegra(prisma: Ctx, id: string, viewer: Viewer) {
  exigirAdmin(viewer);
  if (!(await prisma.regraRoteamento.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError("not-found", "Regra não encontrada");
  await prisma.regraRoteamento.delete({ where: { id } });
  await bestEffort("auditoria-regra", registrarAuditoria({ feitoPorId: viewer.id, acao: "roteamento.regra.excluir", alvo: id }));
}

export type ContatoInput = { nivel: NivelContato; usuarioId?: string | null; email?: string | null; nome?: string | null };

export async function lerHierarquia(prisma: Ctx, setorId: string, viewer: Viewer) {
  exigirAdmin(viewer);
  const setor = await prisma.setor.findUnique({
    where: { id: setorId },
    select: {
      id: true,
      nome: true,
      prazoEscalonamentoHoras: true,
      contatos: {
        orderBy: { criadoEm: "asc" },
        select: { id: true, nivel: true, usuarioId: true, email: true, nome: true, usuario: { select: { id: true, nome: true, emailEducacional: true, emailPessoal: true, papel: true, ativo: true } } },
      },
    },
  });
  if (!setor) throw new ApiError("not-found", "Setor não encontrado");
  return setor;
}

/** Substitui a hierarquia inteira do setor (o que a tela mostra é o que fica). */
export async function salvarHierarquia(
  prisma: Ctx,
  setorId: string,
  dados: { prazoEscalonamentoHoras: number | null; contatos: ContatoInput[] },
  viewer: Viewer,
) {
  exigirAdmin(viewer);
  if (!(await prisma.setor.findUnique({ where: { id: setorId }, select: { id: true } }))) throw new ApiError("not-found", "Setor não encontrado");

  const usuarioIds = [...new Set(dados.contatos.map((c) => c.usuarioId).filter(Boolean) as string[])];
  if (usuarioIds.length) {
    const equipe = await prisma.usuario.count({ where: { id: { in: usuarioIds }, papel: { not: "USUARIO" }, deletadoEm: null } });
    if (equipe !== usuarioIds.length) {
      throw new ApiError("bad-request", "Usuário inválido", "Só funcionários (não alunos) podem estar na hierarquia de um setor.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.setor.update({ where: { id: setorId }, data: { prazoEscalonamentoHoras: dados.prazoEscalonamentoHoras } });
    await tx.setorContato.deleteMany({ where: { setorId } });
    if (dados.contatos.length) {
      await tx.setorContato.createMany({
        data: dados.contatos.map((c) => ({
          setorId,
          nivel: c.nivel,
          usuarioId: c.usuarioId ?? null,
          email: c.usuarioId ? null : c.email?.trim().toLowerCase() ?? null,
          nome: c.usuarioId ? null : c.nome?.trim() || null,
        })),
      });
    }
  });
  await bestEffort(
    "auditoria-hierarquia",
    registrarAuditoria({ feitoPorId: viewer.id, acao: "roteamento.hierarquia", alvo: setorId, meta: { prazo: dados.prazoEscalonamentoHoras, contatos: dados.contatos.length } }),
  );
  return lerHierarquia(prisma, setorId, viewer);
}

/** "Simular": para onde iria um chamado deste serviço/categoria e quem receberia e-mail. */
export async function simular(prisma: Ctx, dados: { servico?: string | null; categoria?: string | null; setorProvavel?: string | null }, viewer: Viewer) {
  exigirAdmin(viewer);
  const destino = await rotearChamado(prisma, dados);
  if (!destino.setorId) return { ...destino, setor: null, setorCopia: null, emails: [], usuarios: 0 };
  const [setor, setorCopia, quem] = await Promise.all([
    prisma.setor.findUnique({ where: { id: destino.setorId }, select: { id: true, nome: true, prazoEscalonamentoHoras: true } }),
    destino.setorCopiaId ? prisma.setor.findUnique({ where: { id: destino.setorCopiaId }, select: { id: true, nome: true } }) : null,
    quemRecebeAoChegar(prisma, destino.setorId, destino.setorCopiaId),
  ]);
  return { ...destino, setor, setorCopia, emails: quem.emails, usuarios: quem.usuarioIds.length };
}
