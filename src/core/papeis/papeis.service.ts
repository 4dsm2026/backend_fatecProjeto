import type { Prisma, PrismaClient } from "@prisma/client";
import { ApiError, toSkipTake } from "../../hateoas";
import type { PapelCreateBody, PapelListResult, PapelUpdateBody, PapeisListQuery, PapelWithUsage } from "./papeis.types";

const papelUsageInclude = {
  _count: { select: { usuarioSetores: true } },
} satisfies Prisma.PapelCatalogoInclude;

function isForeignKeyConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}

export async function listPapeis(prisma: PrismaClient, query: PapeisListQuery): Promise<PapelListResult> {
  const { skip, take } = toSkipTake(query);
  const [items, total] = await Promise.all([
    prisma.papelCatalogo.findMany({
      orderBy: { nome: "asc" },
      skip,
      take,
      include: papelUsageInclude,
    }),
    prisma.papelCatalogo.count(),
  ]);

  return { items, total };
}

export async function createPapel(prisma: PrismaClient, body: PapelCreateBody): Promise<PapelWithUsage> {
  return prisma.papelCatalogo.create({ data: body, include: papelUsageInclude });
}

export async function getPapel(prisma: PrismaClient, id: string): Promise<PapelWithUsage | null> {
  return prisma.papelCatalogo.findUnique({ where: { id }, include: papelUsageInclude });
}

export async function updatePapel(
  prisma: PrismaClient,
  id: string,
  body: PapelUpdateBody,
): Promise<PapelWithUsage> {
  return prisma.papelCatalogo.update({ where: { id }, data: body, include: papelUsageInclude });
}

export async function deletePapel(prisma: PrismaClient, id: string) {
  const inUse = await prisma.usuarioSetor.count({ where: { papelId: id } });
  if (inUse > 0) throw new ApiError("conflict", "Papel em uso por vínculos de usuários.");
  try {
    return await prisma.papelCatalogo.delete({ where: { id } });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw new ApiError("conflict", "Papel associado a vínculo criado durante a exclusão.");
    }
    throw error;
  }
}
