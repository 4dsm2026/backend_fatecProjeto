import type { PrismaClient } from "@prisma/client";

/**
 * Quem, na Fatec, recebe os avisos dos processos acadêmicos (Passe Escolar,
 * trancamento, cancelamento): os membros ativos do setor "Secretaria". Sem esse
 * setor (ou sem membros), os administradores.
 */
export async function alvosDaSecretaria(prisma: PrismaClient): Promise<string[]> {
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
