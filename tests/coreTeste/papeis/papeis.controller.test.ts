import { describe, it, expect, vi, beforeEach } from "vitest";
import { list, create, getOne, patch, removeHard } from "../../../src/core/papeis/papeis.controller.ts";

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

function createReplyMock(): any {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Papeis controller", () => {
  it("list deve retornar lista de papéis", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.findMany.mockResolvedValue([{ id: "1", nome: "Papel1" }]);
    await list({ server: { prisma: prismaMock }, log: { error: vi.fn() } } as any, res);
    expect(res.send).toHaveBeenCalledWith([{ id: "1", nome: "Papel1" }]);
  });

  it("create deve retornar 201 ao criar papel", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.create.mockResolvedValue({ id: "2", nome: "Papel2" });
    await create({ server: { prisma: prismaMock }, log: { error: vi.fn() }, body: { nome: "Papel2" } } as any, res);
    expect(res.code).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ id: "2", nome: "Papel2" });
  });

  it("getOne deve retornar 404 se papel não existir", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.findUnique.mockResolvedValue(null);
    await getOne({ server: { prisma: prismaMock }, log: { error: vi.fn() }, params: { id: "3" } } as any, res);
    expect(res.code).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: "Papel não encontrado" });
  });

  it("patch deve atualizar papel existente", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.update.mockResolvedValue({ id: "4", nome: "Papel4Upd" });
    await patch({ server: { prisma: prismaMock }, log: { error: vi.fn() }, params: { id: "4" }, body: { nome: "Papel4Upd" } } as any, res);
    expect(res.send).toHaveBeenCalledWith({ id: "4", nome: "Papel4Upd" });
  });

  it("removeHard deve retornar 204 ao excluir papel", async () => {
    const res = createReplyMock();
    prismaMock.usuarioSetor.count.mockResolvedValue(0);
    prismaMock.papelCatalogo.delete.mockResolvedValue({ id: "5", nome: "Livre" });
    await removeHard({ server: { prisma: prismaMock }, log: { error: vi.fn() }, params: { id: "5" } } as any, res);
    expect(res.code).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("removeHard deve retornar 409 se papel estiver em uso", async () => {
    const res = createReplyMock();
    prismaMock.usuarioSetor.count.mockResolvedValue(1);
    const err: any = new Error("Papel em uso por vínculos de usuários.");
    err.statusCode = 409;
    prismaMock.papelCatalogo.delete.mockRejectedValue(err);
    await removeHard({ server: { prisma: prismaMock }, log: { error: vi.fn() }, params: { id: "6" } } as any, res);
    expect(res.code).toHaveBeenCalledWith(409);
    expect(res.send).toHaveBeenCalledWith({ error: "Papel em uso por vínculos de usuários." });
  });
});
