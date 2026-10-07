import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  list,
  create,
  getOne,
  patch,
  removeHard,
} from "../../../src/core/papeis/papeis.controller.ts";

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

// Request mínimo compartilhado por todos os handlers testados aqui.
function makeReq(overrides: any = {}): any {
  return {
    server: { prisma: prismaMock },
    log: { error: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

//Testes de sucesso

describe("Papeis controller", () => {
  it("list deve retornar lista de papéis", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.findMany.mockResolvedValue([
      { id: "1", nome: "Papel1" },
    ]);
    await list(makeReq(), res);
    expect(res.send).toHaveBeenCalledWith([{ id: "1", nome: "Papel1" }]);
  });

  it("create deve retornar 201 ao criar papel", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.create.mockResolvedValue({
      id: "2",
      nome: "Papel2",
    });
    await create(makeReq({ body: { nome: "Papel2" } }), res);
    expect(res.code).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ id: "2", nome: "Papel2" });
  });

  it.each([{ id: "3" }, { id: "99" }])(
    "getOne deve retornar 404 se papel não existir (id $id)",
    async ({ id }) => {
      const res = createReplyMock();
      prismaMock.papelCatalogo.findUnique.mockResolvedValue(null);
      await getOne(makeReq({ params: { id } }), res);
      expect(res.code).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({ error: "Papel não encontrado" });
    },
  );

  it("patch deve atualizar papel existente", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.update.mockResolvedValue({
      id: "4",
      nome: "Papel4Upd",
    });
    await patch(
      makeReq({ params: { id: "4" }, body: { nome: "Papel4Upd" } }),
      res,
    );
    expect(res.send).toHaveBeenCalledWith({ id: "4", nome: "Papel4Upd" });
  });

  it("removeHard deve retornar 204 ao excluir papel", async () => {
    const res = createReplyMock();
    prismaMock.usuarioSetor.count.mockResolvedValue(0);
    prismaMock.papelCatalogo.delete.mockResolvedValue({
      id: "5",
      nome: "Livre",
    });
    await removeHard(makeReq({ params: { id: "5" } }), res);
    expect(res.code).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  //Testes de falha

  it("list deve retornar 500 se prisma falhar", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.findMany.mockRejectedValue(
      new Error("Erro interno"),
    );
    await list(makeReq(), res);
    expect(res.code).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ error: "Erro interno" });
  });

  it("create deve retornar 400 se validação falhar", async () => {
    const res = createReplyMock();
    const req = makeReq({ body: {} });
    // simula erro de validação
    const parsed = { error: "Body inválido" };
    (create as any).validator = { parse: () => parsed };
    await create(req, res);
    expect(res.code).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(expect.any(Object));
  });

  it("patch deve retornar 404 se prisma lançar P2025", async () => {
    const res = createReplyMock();
    const err: any = new Error("Registro não encontrado");
    err.code = "P2025";
    prismaMock.papelCatalogo.update.mockRejectedValue(err);
    await patch(makeReq({ params: { id: "10" }, body: { nome: "Teste" } }), res);
    expect(res.code).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: "Papel não encontrado" });
  });

  it("removeHard deve retornar 404 se prisma lançar P2025", async () => {
    const res = createReplyMock();
    const err: any = new Error("Registro não encontrado");
    err.code = "P2025";
    prismaMock.papelCatalogo.delete.mockRejectedValue(err);
    await removeHard(makeReq({ params: { id: "12" } }), res);
    expect(res.code).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: "Papel não encontrado" });
  });

  it("removeHard deve retornar 500 se ocorrer erro inesperado", async () => {
    const res = createReplyMock();
    prismaMock.papelCatalogo.delete.mockRejectedValue(
      new Error("Erro inesperado"),
    );
    await removeHard(makeReq({ params: { id: "13" } }), res);
    expect(res.code).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ error: "Erro inesperado" });
  });

  // Por último de propósito: a segunda linha configura count=1 e
  // clearAllMocks() no beforeEach não zera implementação de mock.
  it.each([
    { id: "11", vinculos: undefined },
    { id: "6", vinculos: 1 },
  ])(
    "removeHard deve retornar 409 se papel estiver em uso (id $id)",
    async ({ id, vinculos }) => {
      const res = createReplyMock();
      if (vinculos !== undefined) {
        prismaMock.usuarioSetor.count.mockResolvedValue(vinculos);
      }
      const err: any = new Error("Papel em uso por vínculos de usuários.");
      err.statusCode = 409;
      prismaMock.papelCatalogo.delete.mockRejectedValue(err);
      await removeHard(makeReq({ params: { id } }), res);
      expect(res.code).toHaveBeenCalledWith(409);
      expect(res.send).toHaveBeenCalledWith({
        error: "Papel em uso por vínculos de usuários.",
      });
    },
  );
});
