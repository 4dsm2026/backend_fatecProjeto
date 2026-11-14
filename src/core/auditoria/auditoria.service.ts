import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError, toSkipTake } from "../../hateoas";
import type { AuditoriaListQuery, RegistrarAuditoriaDTO } from "./auditoria.types";

export class AuditoriaService {
  registrar(data: RegistrarAuditoriaDTO, actorId: string) {
    return prisma.auditoria.create({
      data: {
        acao: data.acao,
        alvo: data.alvo ?? null,
        meta: data.meta === undefined ? undefined : (data.meta as Prisma.InputJsonValue),
        feitoPorId: actorId,
      },
    });
  }

  async obterPorId(id: string) {
    const log = await prisma.auditoria.findUnique({
      where: { id },
      include: {
        feitoPor: { select: { id: true, nome: true, ra: true } },
      },
    });

    if (!log) {
      throw new ApiError("not-found", "Registro de auditoria não encontrado");
    }

    return log;
  }

  async listar(query: AuditoriaListQuery) {
    const where = {
      ...(query.userId ? { feitoPorId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            feitoEm: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const pagination = toSkipTake(query);

    const [total, items] = await Promise.all([
      prisma.auditoria.count({ where }),
      prisma.auditoria.findMany({
        where,
        orderBy: { feitoEm: "desc" },
        ...pagination,
        include: {
          feitoPor: { select: { id: true, nome: true, ra: true } },
        },
      }),
    ]);

    return { total, items };
  }
}
