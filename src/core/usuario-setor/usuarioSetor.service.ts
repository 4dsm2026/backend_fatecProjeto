import { PrismaClient, Prisma } from "@prisma/client";
import { toSkipTake } from "../../hateoas/pagination.js";
import type {
  VincularBody, AlterarPapelBody,
  ListUsuariosDoSetorQuery, ListSetoresDoUsuarioQuery
} from "./usuarioSetor.types";

export type VincularInput =
  | [usuarioId: string, body: VincularBody]
  | [data: { usuarioId: string; setorId: string; papelId?: string | null }];

export async function vincularUsuarioSetor(
  prisma: PrismaClient,
  usuarioIdOrData: string | { usuarioId: string; setorId: string; papelId?: string | null },
  maybeBody?: VincularBody
) {
  let usuarioId: string;
  let setorId: string;
  let papelId: string | null = null;

  if (typeof usuarioIdOrData === "string") {
    usuarioId = usuarioIdOrData;
    setorId = maybeBody!.setorId;
    papelId = maybeBody?.papelId ?? null;
  } else {
    usuarioId = usuarioIdOrData.usuarioId;
    setorId = usuarioIdOrData.setorId;
    papelId = usuarioIdOrData.papelId ?? null;
  }

  return prisma.usuarioSetor.create({
    data: { usuarioId, setorId, papelId },
    include: { setor: true, papel: true },
  });
}

export async function alterarPapelNoSetor(
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

export const alterarPapelUsuarioSetor = alterarPapelNoSetor;

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
  const page = q.page ?? 0;
  const size = q.size ?? q.perPage ?? 20;
  const { skip, take } = toSkipTake({ page, size });
  const search = q.search;

  const whereUsuario = search
    ? {
        OR: [
          { nome: { contains: search } },
          { emailPessoal: { contains: search } },
          { emailEducacional: { contains: search } },
          { ra: { contains: search } },
        ],
      }
    : {};

  const where = {
    setorId,
    ...(search ? { usuario: whereUsuario } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.usuarioSetor.findMany({
      where,
      skip,
      take,
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
    prisma.usuarioSetor.count({ where }),
  ]);

  return { data, total, page, size, perPage: size };
}

export async function listarSetoresDoUsuario(
  prisma: PrismaClient,
  usuarioId: string,
  q: ListSetoresDoUsuarioQuery
) {
  const page = q.page ?? 0;
  const size = q.size ?? q.perPage ?? 20;
  const { skip, take } = toSkipTake({ page, size });

  const [data, total] = await Promise.all([
    prisma.usuarioSetor.findMany({
      where: { usuarioId },
      skip,
      take,
      orderBy: { criadoEm: "desc" },
      include: { setor: true, papel: true },
    }),
    prisma.usuarioSetor.count({ where: { usuarioId } }),
  ]);

  return { data, total, page, size, perPage: size };
}
