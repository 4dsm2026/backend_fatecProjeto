import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listPapeis,
  createPapel,
  getPapel,
  updatePapel,
  deletePapel,
} from "../../../src/core/papeis/papeis.service.ts";

//mock
const prismaMock = {
  papelCatalogo: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  usuarioSetor: {
    count: vi.fn(),
  },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Papeis service", () => {
  it("listPapeis deve retornar lista ordenada", async () => {
    prismaMock.papelCatalogo.findMany.mockResolvedValue([{ id: "1", nome: "Papel1" }]);
    const result = await listPapeis(prismaMock);
    expect(result).toEqual([{ id: "1", nome: "Papel1" }]);
    expect(prismaMock.papelCatalogo.findMany).toHaveBeenCalledWith({ orderBy: { nome: "asc" } });
  });

  it("createPapel deve criar um papel", async () => {
    const body = { nome: "Papel2" };
    prismaMock.papelCatalogo.create.mockResolvedValue({ id: "2", ...body });
    const result = await createPapel(prismaMock, body);
    expect(result).toEqual({ id: "2", nome: "Papel2" });
  });

  it("getPapel deve buscar por id", async () => {
    prismaMock.papelCatalogo.findUnique.mockResolvedValue({ id: "3", nome: "Papel3" });
    const result = await getPapel(prismaMock, "3");
    expect(result).toEqual({ id: "3", nome: "Papel3" });
  });

  it("updatePapel deve atualizar dados", async () => {
    const body = { nome: "Papel4Upd" };
    prismaMock.papelCatalogo.update.mockResolvedValue({ id: "4", ...body });
    const result = await updatePapel(prismaMock, "4", body);
    expect(result).toEqual({ id: "4", nome: "Papel4Upd" });
  });

  it("deletePapel deve lançar erro se papel estiver em uso", async () => {
    prismaMock.usuarioSetor.count.mockResolvedValue(1);
    await expect(deletePapel(prismaMock, "5")).rejects.toThrow("Papel em uso por vínculos de usuários.");
  });

  it("deletePapel deve excluir se não estiver em uso", async () => {
    prismaMock.usuarioSetor.count.mockResolvedValue(0);
    prismaMock.papelCatalogo.delete.mockResolvedValue({ id: "6", nome: "Livre" });
    const result = await deletePapel(prismaMock, "6");
    expect(result).toEqual({ id: "6", nome: "Livre" });
  });
});