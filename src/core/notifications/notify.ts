import type { PrismaClient } from "@prisma/client";

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
  if (!alvos.length) return;

  await prisma.notificacao.createMany({
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
}
