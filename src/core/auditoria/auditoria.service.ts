import { prisma } from "../../lib/prisma";
import { RegistrarAuditoriaDTO } from "./auditoria.types";

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

  async listar() {
    return prisma.auditoria.findMany({
      orderBy: { feitoEm: "desc" },
      include: { feitoPor: true },
    });
  }

  async listarPorUsuario(usuarioId: string) {
    return prisma.auditoria.findMany({
      where: { feitoPorId: usuarioId },
      orderBy: { feitoEm: "desc" },
      include: { feitoPor: true },
    });
  }

  async listarPorPeriodo(inicio: Date, fim: Date) {
    return prisma.auditoria.findMany({
      where: {
        feitoEm: {
          gte: inicio,
          lte: fim,
        },
      },
      orderBy: { feitoEm: "desc" },
      include: { feitoPor: true },
    });
  }
}
