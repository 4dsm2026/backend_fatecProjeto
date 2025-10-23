import type { PrismaClient } from "@prisma/client";
import type { PapelCreateBody, PapelUpdateBody } from "./papeis.types";

export async function listPapeis(prisma: PrismaClient) {
  return prisma.papelCatalogo.findMany({ orderBy: { nome: "asc" } });
}

export async function createPapel(prisma: PrismaClient, body: PapelCreateBody) {
  return prisma.papelCatalogo.create({ data: body });
}

export async function getPapel(prisma: PrismaClient, id: string) {
  return prisma.papelCatalogo.findUnique({ where: { id } });
}

export async function updatePapel(prisma: PrismaClient, id: string, body: PapelUpdateBody) {
  return prisma.papelCatalogo.update({ where: { id }, data: body });
}

export async function deletePapel(prisma: PrismaClient, id: string) {
  const inUse = await prisma.usuarioSetor.count({ where: { papelId: id } });
  if (inUse) {
    const err: any = new Error("Papel em uso por vínculos de usuários.");
    err.statusCode = 409;
    throw err;
  }
  return prisma.papelCatalogo.delete({ where: { id } });
}
