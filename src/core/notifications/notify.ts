import type { PrismaClient } from "@prisma/client";
import { getMailDriver } from "../../config/mail";
import { escapeHtml } from "../../utils/escape-html";

/** unions de string iguais às do schema.prisma */
export type TipoNotificacao =
  | "CHAMADO_CRIADO"
  | "CHAMADO_ATRIBUIDO"
  | "CHAMADO_ATUALIZADO"
  | "STATUS_ALTERADO"
  | "MENSAGEM_NOVA"
  | "ANEXO_NOVO"
  | "SISTEMA";

export type CanalNotificacao = "IN_APP" | "EMAIL" | "PUSH";

type Ctx = PrismaClient;

/** Cria várias notificações de uma vez para uma lista de usuários */
export async function notifyMany(
  prisma: Ctx,
  usuarios: string[],
  data: {
    titulo: string;
    mensagem: string;
    tipo: TipoNotificacao;
    canal?: CanalNotificacao;
    chamadoId?: string | null;
    mensagemId?: string | null;
    organizacaoId?: string | null;
    anexoId?: string | null;
    meta?: any;
  }
) {
  if (!usuarios.length) return;

  // Respeita a preferência do usuário: só notifica quem tem notificacoesInApp=true.
  const optIn = await prisma.usuario.findMany({
    where: { id: { in: usuarios }, notificacoesInApp: true },
    select: { id: true },
  });
  const alvos = optIn.map((u) => u.id);
  if (alvos.length) await prisma.notificacao.createMany({
    data: alvos.map((usuarioId) => ({
      usuarioId,
      titulo: data.titulo,
      mensagem: data.mensagem,
      tipo: data.tipo,
      canal: data.canal ?? "IN_APP",
      chamadoId: data.chamadoId ?? null,
      mensagemId: data.mensagemId ?? null,
      organizacaoId: data.organizacaoId ?? null,
      anexoId: data.anexoId ?? null,
      meta: data.meta ?? null,
    })),
  });

  await sendNotificationEmails(prisma, usuarios, data.titulo, data.mensagem);
}

/** Envia por e-mail independentemente da preferência de notificações internas. */
export async function sendNotificationEmails(prisma: Ctx, usuarios: string[], titulo: string, mensagem: string) {
  if (!usuarios.length) return;
  const emailUsers = await prisma.usuario.findMany({
    where: { id: { in: usuarios }, notificacoesEmail: true, ativo: true, deletadoEm: null },
    select: { emailPessoal: true, emailEducacional: true },
  });
  const recipients = [...new Set(emailUsers.map(user => user.emailPessoal ?? user.emailEducacional).filter((email): email is string => Boolean(email)))];
  const deliveries = await Promise.allSettled(recipients.map(to => Promise.resolve().then(() => getMailDriver().send({
    to,
    subject: titulo,
    html: `<p>${escapeHtml(mensagem)}</p>`,
  }))));
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") console.error("Falha ao enviar notificação por e-mail", delivery.reason);
  }
}
