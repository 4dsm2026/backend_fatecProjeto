import type { Prisma, PrismaClient } from "@prisma/client";
import { ApiError, toSkipTake } from "../../hateoas";
import type { PapelCreateBody, PapelListResult, PapelUpdateBody, PapeisListQuery, PapelWithUsage } from "./papeis.types";

const papelUsageInclude = {
  _count: { select: { usuarioSetores: true } },
} satisfies Prisma.PapelCatalogoInclude;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function duplicateRoleNameError(): ApiError {
  return new ApiError("conflict", "Já existe um papel com esse nome.");
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
  try {
    return await prisma.papelCatalogo.create({ data: body, include: papelUsageInclude });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) throw duplicateRoleNameError();
    throw error;
  }
}

export async function getPapel(prisma: PrismaClient, id: string): Promise<PapelWithUsage | null> {
  return prisma.papelCatalogo.findUnique({ where: { id }, include: papelUsageInclude });
}

export async function updatePapel(
  prisma: PrismaClient,
  id: string,
  body: PapelUpdateBody,
): Promise<PapelWithUsage> {
  try {
    return await prisma.papelCatalogo.update({ where: { id }, data: body, include: papelUsageInclude });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) throw duplicateRoleNameError();
    throw error;
  }
}

export async function deletePapel(prisma: PrismaClient, id: string) {
  const deleted = await prisma.papelCatalogo.deleteMany({
    where: { id, usuarioSetores: { none: {} } },
  });
  if (deleted.count > 0) return deleted;

  const existing = await prisma.papelCatalogo.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError("not-found", "Papel não encontrado");
  throw new ApiError("conflict", "Papel em uso por vínculos de usuários.");
}
