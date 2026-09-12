import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSetor,
  getSetorById,
  listSetores,
  updateSetor,
  deleteSetor,
} from "../../../src/core/setores/setores.service.ts";

const prismaMock = {
  setor: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Setores Service", () => {
  it("Deve criar um setor com sucesso (Sucesso)", async () => {
    const body = { nome: "TI" };
    prismaMock.setor.create.mockResolvedValue({ id: "setor-1", ...body });

    const result = await createSetor(prismaMock, body);

    expect(result).toEqual({ id: "setor-1", nome: "TI" });
    expect(prismaMock.setor.create).toHaveBeenCalledWith({ data: body });
  });

  it("Deve retornar um setor por ID quando existente (Sucesso)", async () => {
    const mockSetor = {
      id: "setor-1",
      nome: "TI",
      _count: { usuarioSetores: 0, chamados: 0 },
    };
    prismaMock.setor.findUnique.mockResolvedValue(mockSetor);

    const result = await getSetorById(prismaMock, "setor-1");

    expect(result).toEqual(mockSetor);
    expect(prismaMock.setor.findUnique).toHaveBeenCalledWith({
      where: { id: "setor-1" },
      include: {
        _count: { select: { usuarioSetores: true, chamados: true } },
      },
    });
  });

  it("Deve retornar a lista de setores cadastrados (Sucesso)", async () => {
    const mockList = [{ id: "setor-1", nome: "TI" }];
    prismaMock.setor.findMany.mockResolvedValue(mockList);
    prismaMock.setor.count.mockResolvedValue(1);

    const result = await listSetores(prismaMock, {});

    expect(result).toEqual({
      data: mockList,
      total: 1,
      page: 1,
      perPage: 20,
    });
    expect(prismaMock.setor.findMany).toHaveBeenCalled();
    expect(prismaMock.setor.count).toHaveBeenCalled();
  });

  it("Deve atualizar um setor existente (Sucesso)", async () => {
    const body = { nome: "TI Atualizado" };
    prismaMock.setor.update.mockResolvedValue({ id: "setor-1", ...body });

    const result = await updateSetor(prismaMock, "setor-1", body);

    expect(result).toEqual({ id: "setor-1", nome: "TI Atualizado" });
    expect(prismaMock.setor.update).toHaveBeenCalledWith({
      where: { id: "setor-1" },
      data: body,
    });
  });

  it("Deve remover o setor com sucesso (Sucesso)", async () => {
    prismaMock.setor.delete.mockResolvedValue({ id: "setor-1", nome: "TI" });

    const result = await deleteSetor(prismaMock, "setor-1");

    expect(result).toEqual({ id: "setor-1", nome: "TI" });
    expect(prismaMock.setor.delete).toHaveBeenCalledWith({
      where: { id: "setor-1" },
    });
  });
});