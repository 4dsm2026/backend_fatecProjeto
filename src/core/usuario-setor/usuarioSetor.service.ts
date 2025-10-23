import { PrismaClient, Prisma } from "@prisma/client";
import type {
  VincularBody, AlterarPapelBody,
  ListUsuariosDoSetorQuery, ListSetoresDoUsuarioQuery
} from "./usuarioSetor.types";

export async function vincularUsuarioSetor(
  prisma: PrismaClient,
  usuarioId: string,
  body: VincularBody
) {
  const { setorId, papelId = null } = body

  try {
    return await prisma.usuarioSetor.create({
      data: { usuarioId, setorId, papelId },
      include: { setor: true, papel: true },
    });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const err: any = new Error("Vínculo já existente.");
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

export async function alterarPapelUsuarioSetor(
  prisma: PrismaClient,
  usuarioSetorId: string,
  body: AlterarPapelBody
) {
  return prisma.usuarioSetor.update({
    where: { id: usuarioSetorId },
    data: { papelId: body.papelId ?? null },
    include: { setor: true, papel: true },
  });
}

export async function desvincularUsuarioSetor(
  prisma: PrismaClient,
  usuarioSetorId: string
) {
  return prisma.usuarioSetor.delete({ where: { id: usuarioSetorId } });
}

export async function listarUsuariosDoSetor(
  prisma: PrismaClient,
  setorId: string,
  q: ListUsuariosDoSetorQuery
) {
  const { page = 1, perPage = 20, search } = q;
  const whereUsuario = search
    ? {
        OR: [
          { nome: { contains: search, mode: "insensitive" as const } },
          { emailPessoal: { contains: search, mode: "insensitive" as const } },
          { emailEducacional: { contains: search, mode: "insensitive" as const } },
          { ra: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [data, total] = await Promise.all([
    prisma.usuarioSetor.findMany({
      where: { setorId, usuario: whereUsuario },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { criadoEm: "desc" },
      include: {
        usuario: {
          select: {
            id: true, nome: true, emailPessoal: true, emailEducacional: true,
            ra: true, papel: true, ativo: true,
          },
        },
        papel: true,
      },
    }),
    prisma.usuarioSetor.count({ where: { setorId, usuario: whereUsuario } }),
  ]);

  return { data, total, page, perPage };
}

export async function listarSetoresDoUsuario(
  prisma: PrismaClient,
  usuarioId: string,
  q: ListSetoresDoUsuarioQuery
) {
  const { page = 1, perPage = 20 } = q;
  const [data, total] = await Promise.all([
    prisma.usuarioSetor.findMany({
      where: { usuarioId },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { criadoEm: "desc" },
      include: { setor: true, papel: true },
    }),
    prisma.usuarioSetor.count({ where: { usuarioId } }),
  ]);
  return { data, total, page, perPage };
}
