import type { Prisma, PrismaClient } from "@prisma/client";
import { toSkipTake } from "../../hateoas/pagination";
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
  const { page = 0, size = 20, search, organizacaoId } = q;
  const { skip, take } = toSkipTake({ page, size });
  const where: Prisma.SetorWhereInput = {
    ...(organizacaoId ? { organizacaoId } : {}),
    // MySQL: a collation padrão já é case-insensitive (não existe `mode`).
    ...(search ? { nome: { contains: search } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.setor.findMany({
      where,
      orderBy: { nome: "asc" },
      skip,
      take,
    }),
    prisma.setor.count({ where }),
  ]);
  return { data, total, page, size };
}

export async function updateSetor(prisma: PrismaClient, id: string, data: SetorUpdateBody) {
  return prisma.setor.update({ where: { id }, data });
}

export async function deleteSetor(prisma: PrismaClient, id: string) {
  return prisma.setor.delete({ where: { id } });
}
