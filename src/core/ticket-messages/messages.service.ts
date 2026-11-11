import { PrismaClient } from "@prisma/client";
import { toSkipTake } from "../../hateoas";
import { appGlobals } from "../../types/app-globals";
import type { ListMessagesQuery } from "./messages.types";
import { rotuloChamado } from "../../utils/protocolo";

type Ctx = PrismaClient;

/** Autor nas respostas de mensagem: só os dados públicos. */
const AUTOR_PUBLICO = {
  autor: { select: { id: true, nome: true, emailPessoal: true } },
};

const DEFAULT_PAGE_SIZE = 20;

/**
 * Cria uma nova mensagem vinculada a um chamado
 */
export async function createTicketMessage(
  prisma: Ctx,
  chamadoId: string,
  autorId: string,
  conteudo: string
) {
  // 💾 Cria a mensagem no banco
  const msg = await prisma.mensagem.create({
    data: { chamadoId, autorId, conteudo },
    include: AUTOR_PUBLICO,
  });

  // 🔔 Busca os usuários relacionados ao chamado (solicitante, responsável e setor)
  const chamado = await prisma.chamado.findUnique({
    where: { id: chamadoId },
    select: {
      criadoPorId: true,
      responsavelId: true,
      setorId: true,
      organizacaoId: true,
      protocolo: true,
    },
  });

  const userIds = new Set<string>();
  if (chamado?.criadoPorId && chamado.criadoPorId !== autorId) userIds.add(chamado.criadoPorId);
  if (chamado?.responsavelId && chamado.responsavelId !== autorId) userIds.add(chamado.responsavelId);

  if (chamado?.setorId) {
    const vinculos = await prisma.usuarioSetor.findMany({
      where: { setorId: chamado.setorId, usuario: { ativo: true } },
      select: { usuarioId: true },
    });
    vinculos.forEach(v => { if (v.usuarioId !== autorId) userIds.add(v.usuarioId); });
  }

  const globals = appGlobals();

  // 🔥 1. Broadcast WebSocket (para atualizar os chats de todos conectados).
  // Exceção ao REST: o canal em tempo real não tem `_links`; o payload da mensagem é o mesmo de antes.
  globals.broadcastWS?.({
    type: "nova_mensagem",
    chamadoId,
    mensagem: msg,
  });

  // 🔔 2. Notificação persistente (banco + push realtime)
  const app = globals.fastifyAppInstance;
  if (app?.notifyUsers && userIds.size > 0) {
    await app.notifyUsers(
      Array.from(userIds),
      {
        titulo: "Nova mensagem no chamado",
        mensagem: `O chamado ${rotuloChamado(chamado?.protocolo)} recebeu uma nova mensagem.`,
        tipo: "MENSAGEM_NOVA",
        canal: "IN_APP",
        meta: {
          chamadoId,
          autorId,
          conteudo,
          protocolo: chamado?.protocolo,
        },
      },
    );
  }

  return msg;
}

/**
 * Lista as mensagens de um chamado (página a partir de 0)
 */
export async function listTicketMessages(
  prisma: Ctx,
  chamadoId: string,
  query: Partial<ListMessagesQuery>
) {
  const { page = 0, size = DEFAULT_PAGE_SIZE, orderDir = "asc" } = query;
  const where = { chamadoId, deletadoEm: null };

  const [total, mensagens] = await Promise.all([
    prisma.mensagem.count({ where }),
    prisma.mensagem.findMany({
      where,
      orderBy: { criadoEm: orderDir },
      ...toSkipTake({ page, size }),
      include: AUTOR_PUBLICO,
    }),
  ]);

  return { total, page, size, mensagens };
}

/**
 * Busca uma mensagem de um chamado
 */
export async function getTicketMessage(prisma: Ctx, chamadoId: string, id: string) {
  return prisma.mensagem.findFirst({
    where: { id, chamadoId, deletadoEm: null },
    include: AUTOR_PUBLICO,
  });
}

/** Mensagens do chamado que o usuário ainda não leu: as que outras pessoas escreveram. */
const unreadWhere = (chamadoId: string | { in: string[] }, userId: string) => ({
  chamadoId,
  deletadoEm: null,
  lidaEm: null,
  autorId: { not: userId },
});

/**
 * Quantas mensagens do chamado o usuário ainda não leu
 */
export async function countUnreadMessages(prisma: Ctx, chamadoId: string, userId: string) {
  return prisma.mensagem.count({ where: unreadWhere(chamadoId, userId) });
}

/**
 * Quantas mensagens não lidas cada chamado tem para o usuário, numa consulta só.
 * Chamado sem mensagem não lida não aparece no mapa (conte como 0).
 */
export async function countUnreadByTicket(prisma: Ctx, chamadoIds: string[], userId: string) {
  if (chamadoIds.length === 0) return new Map<string, number>();

  const grupos = await prisma.mensagem.groupBy({
    by: ["chamadoId"],
    where: unreadWhere({ in: chamadoIds }, userId),
    _count: { _all: true },
  });

  return new Map(grupos.map((g) => [g.chamadoId, g._count._all]));
}

/**
 * Marca como lidas as mensagens do chamado escritas por outras pessoas
 */
export async function markMessagesAsRead(prisma: Ctx, chamadoId: string, userId: string) {
  const result = await prisma.mensagem.updateMany({
    where: unreadWhere(chamadoId, userId),
    data: { lidaEm: new Date() },
  });

  return { updatedCount: result.count };
}