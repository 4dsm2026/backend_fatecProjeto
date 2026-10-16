import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../src/lib/prisma");
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { AuditoriaService } from "../../../src/core/auditoria/auditoria.service";

describe("AuditoriaService", () => {
  beforeEach(() => vi.resetAllMocks());

  it("registra uma entrada", async () => {
    const created = { id: "log-1", acao: "CHAMADO_FECHADO", feitoPorId: "admin-1" };
    prismaMock.auditoria.create.mockResolvedValue(created as never);

    const result = await new AuditoriaService().registrar({
      acao: "CHAMADO_FECHADO",
      feitoPorId: "admin-1",
    });

    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: {
        acao: "CHAMADO_FECHADO",
        alvo: null,
        meta: undefined,
        feitoPorId: "admin-1",
      },
    });
    expect(result).toEqual(created);
  });

  it("paginates and filters the audit history", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T00:00:00.000Z");
    const item = { id: "log-1", feitoPorId: "admin-1" };
    prismaMock.auditoria.count.mockResolvedValue(1);
    prismaMock.auditoria.findMany.mockResolvedValue([item] as never);

    const result = await new AuditoriaService().listar({
      page: 1,
      size: 10,
      userId: "admin-1",
      from,
      to,
    });

    const where = {
      feitoPorId: "admin-1",
      feitoEm: { gte: from, lte: to },
    };
    expect(prismaMock.auditoria.count).toHaveBeenCalledWith({ where });
    expect(prismaMock.auditoria.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { feitoEm: "desc" },
      skip: 10,
      take: 10,
      include: { feitoPor: { select: { id: true, nome: true, ra: true } } },
    });
    expect(result).toEqual({ total: 1, items: [item] });
  });

  it("propaga falhas de persistência", async () => {
    prismaMock.auditoria.count.mockRejectedValue(new Error("Database unavailable"));
    prismaMock.auditoria.findMany.mockResolvedValue([]);

    await expect(
      new AuditoriaService().listar({ page: 0, size: 20 }),
    ).rejects.toThrow("Database unavailable");
  });
});
