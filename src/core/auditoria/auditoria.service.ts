import { prisma } from "../../lib/prisma";
import type { AuditoriaListQuery, RegistrarAuditoriaDTO } from "./auditoria.types";

export class AuditoriaService {
  async registrar(data: RegistrarAuditoriaDTO) {
    return prisma.auditoria.create({
      data: {
        acao: data.acao,
        alvo: data.alvo ?? null,
        meta: data.meta ?? undefined,
        feitoPorId: data.feitoPorId ?? null,
      },
    });
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
    const skip = query.page * query.size;

    const [total, items] = await Promise.all([
      prisma.auditoria.count({ where }),
      prisma.auditoria.findMany({
        where,
        orderBy: { feitoEm: "desc" },
        skip,
        take: query.size,
        include: {
          feitoPor: { select: { id: true, nome: true, ra: true } },
        },
      }),
    ]);

    return { total, items };
  }
}
