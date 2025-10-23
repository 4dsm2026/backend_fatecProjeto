import type { PrismaClient } from "@prisma/client";
import type { SetorCreateBody, SetoresListQuery, SetorUpdateBody } from "./setores.types";

export async function createSetor(prisma: PrismaClient, data: SetorCreateBody) {
  return prisma.setor.create({ data });
}

export async function getSetorById(prisma: PrismaClient, id: string) {
  return prisma.setor.findUnique({
    where: { id },
    include: {
      _count: { select: { usuarioSetores: true, chamados: true } },
    },
  });
}

export async function listSetores(prisma: PrismaClient, q: SetoresListQuery) {
  const { page = 1, perPage = 20, search, organizacaoId } = q;
  const where: any = {
    ...(organizacaoId ? { organizacaoId } : {}),
    ...(search ? { nome: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.setor.findMany({
      where,
      orderBy: { nome: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.setor.count({ where }),
  ]);
  return { data, total, page, perPage };
}

export async function updateSetor(prisma: PrismaClient, id: string, data: SetorUpdateBody) {
  return prisma.setor.update({ where: { id }, data });
}

export async function deleteSetor(prisma: PrismaClient, id: string) {
  return prisma.setor.delete({ where: { id } });
}
