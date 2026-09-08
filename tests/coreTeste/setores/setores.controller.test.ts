import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  create,
  getOne,
  list,
  patch,
  removeHard as remove,
} from "../../../src/core/setores/setores.controller.ts";

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

function createReplyMock(): any {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Setores Controller", () => {
  it("Deve responder status 201 ao criar setor (Sucesso)", async () => {
    const res = createReplyMock();
    prismaMock.setor.create.mockResolvedValue({ id: "1", nome: "Financeiro" });

    await create(
      {
        server: { prisma: prismaMock },
        log: { error: vi.fn() },
        body: { nome: "Financeiro" },
      } as any,
      res
    );

    expect(res.code).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ id: "1", nome: "Financeiro" });
  });

  it("Deve retornar status 404 caso o setor não exista (Erro)", async () => {
    const res = createReplyMock();
    prismaMock.setor.findUnique.mockResolvedValue(null);

    await getOne(
      {
        server: { prisma: prismaMock },
        log: { error: vi.fn() },
        params: { id: "123e4567-e89b-12d3-a456-426614174000" },
      } as any,
      res
    );

    expect(res.code).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: "Setor não encontrado" });
  });

  it("Deve retornar status 204 ao remover setor com sucesso (Sucesso)", async () => {
    const res = createReplyMock();
    prismaMock.setor.delete.mockResolvedValue({ id: "1", nome: "Financeiro" });

    await remove(
      {
        server: { prisma: prismaMock },
        log: { error: vi.fn() },
        params: { id: "123e4567-e89b-12d3-a456-426614174000" },
      } as any,
      res
    );

    expect(res.code).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});