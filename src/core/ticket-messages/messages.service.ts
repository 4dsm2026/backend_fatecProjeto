import { PrismaClient } from "@prisma/client";
import type { ListMessagesQuery } from "./messages.types";
import { notifyMany } from "../notifications/notify";

type Ctx = PrismaClient;

export async function createTicketMessage(
  prisma: Ctx,
  chamadoId: string,
  autorId: string,
  conteudo: string
) {
  // verifica existência e se não está deletado
  const chamado = await prisma.chamado.findFirst({
    where: { id: chamadoId, deletadoEm: null },
    select: { id: true, protocolo: true, criadoPorId: true, responsavelId: true, organizacaoId: true },
  });
  if (!chamado) {
    throw Object.assign(new Error("Chamado não encontrado"), { code: "P2025" });
  }

  const msg = await prisma.mensagem.create({
    data: { chamadoId, autorId, conteudo },
    select: { id: true, criadoEm: true },
  });

  // Notifica criador e responsável (exceto o autor)
  const alvos = new Set<string>();
  if (chamado.criadoPorId && chamado.criadoPorId !== autorId) alvos.add(chamado.criadoPorId);
  if (chamado.responsavelId && chamado.responsavelId !== autorId) alvos.add(chamado.responsavelId);

  if (alvos.size) {
    await notifyMany(prisma, Array.from(alvos), {
      titulo: "Nova mensagem no chamado",
      mensagem: `Você tem uma nova mensagem no chamado ${chamado.protocolo ?? chamado.id}.`,
      tipo: "MENSAGEM_NOVA",
      canal: "IN_APP",
      chamadoId,
      mensagemId: msg.id,
      organizacaoId: chamado.organizacaoId ?? null,
    });
  }

  return msg;
}

export async function listTicketMessages(
  prisma: Ctx,
  chamadoId: string,
  q: ListMessagesQuery
) {
  // valida chamado
  const exists = await prisma.chamado.findFirst({
    where: { id: chamadoId, deletadoEm: null },
    select: { id: true },
  });
  if (!exists) {
    throw Object.assign(new Error("Chamado não encontrado"), { code: "P2025" });
  }

  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 100;
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const where = { chamadoId };
  const [total, items] = await Promise.all([
    prisma.mensagem.count({ where }),
    prisma.mensagem.findMany({
      where,
      orderBy: { criadoEm: q.orderDir ?? "asc" },
      skip,
      take,
      select: {
        id: true,
        conteudo: true,
        criadoEm: true,
        atualizadoEm: true,
        autor: { select: { id: true, nome: true, emailPessoal: true } },
      },
    }),
  ]);

  return { total, page, pageSize, items };
}
