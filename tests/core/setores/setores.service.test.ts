import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createSetor,
  deleteSetor,
  getSetorById,
  listSetores,
  updateSetor,
} from "../../../src/core/setores/setores.service.js";

function createMockPrisma() {
  return {
    setor: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("setores.service", () => {
  it("lista setores com paginação base 0 (toSkipTake) e filtro de busca", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.setor.findMany).mockResolvedValue([]);
    vi.mocked(prisma.setor.count).mockResolvedValue(0);

    await listSetores(prisma, { page: 2, size: 10, search: "Suporte" });

    expect(prisma.setor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nome: { contains: "Suporte" } },
        skip: 20,
        take: 10,
      })
    );
  });

  it("cria um novo setor", async () => {
    const prisma = createMockPrisma();
    const mockSetor = {
      id: "sec-1",
      nome: "Secretaria Acadêmica",
      descricao: "Atendimento ao aluno",
      organizacaoId: null,
    };
    vi.mocked(prisma.setor.create).mockResolvedValue(mockSetor as never);

    const created = await createSetor(prisma, {
      nome: "Secretaria Acadêmica",
      descricao: "Atendimento ao aluno",
    });

    expect(created).toEqual(mockSetor);
  });

  it("busca setor por id", async () => {
    const prisma = createMockPrisma();
    const mockSetor = { id: "sec-1", nome: "TI" };
    vi.mocked(prisma.setor.findUnique).mockResolvedValue(mockSetor as never);

    const result = await getSetorById(prisma, "sec-1");
    expect(result).toEqual(mockSetor);
  });

  it("atualiza parcialmente um setor", async () => {
    const prisma = createMockPrisma();
    const updated = { id: "sec-1", nome: "TI Atualizado" };
    vi.mocked(prisma.setor.update).mockResolvedValue(updated as never);

    const result = await updateSetor(prisma, "sec-1", {
      nome: "TI Atualizado",
    });
    expect(result).toEqual(updated);
  });

  it("remove um setor permanentemente", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.setor.delete).mockResolvedValue({ id: "sec-1" } as never);

    await deleteSetor(prisma, "sec-1");
    expect(prisma.setor.delete).toHaveBeenCalledWith({
      where: { id: "sec-1" },
    });
  });
});