import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import * as service from "../../../src/core/usuario-setor/usuarioSetor.service";

// ============================================================================
// 1. SETUP DO MOCK DO PRISMA CLIENT
// ============================================================================
// Em testes unitários de Service, como usamos Injeção de Dependência,
// não precisamos dar mock no módulo global do Prisma, apenas passar
// um objeto falso com a mesma assinatura que o service espera.
const mockPrisma = {
  usuarioSetor: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
} as unknown as PrismaClient;

describe("UsuarioSetor Service", () => {
  // Garantimos que nenhum teste interfira no outro, zerando contadores de chamadas
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // SUÍTE: vincularUsuarioSetor
  // ============================================================================
  describe("vincularUsuarioSetor", () => {
    const usuarioId = "user-123";

    it("deve vincular um usuário a um setor com papel definido (Branch Completo)", async () => {
      const mockRetornoDb = { id: "vinc-1", usuarioId, setorId: "set-1", papelId: "papel-1" };
      vi.mocked(mockPrisma.usuarioSetor.create).mockResolvedValueOnce(mockRetornoDb as any);

      const resultado = await service.vincularUsuarioSetor(mockPrisma, usuarioId, {
        setorId: "set-1",
        papelId: "papel-1",
      });

      expect(mockPrisma.usuarioSetor.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.usuarioSetor.create).toHaveBeenCalledWith({
        data: { usuarioId, setorId: "set-1", papelId: "papel-1" },
        include: { setor: true, papel: true },
      });
      expect(resultado).toStrictEqual(mockRetornoDb);
    });

    it("deve assumir papelId nulo caso não seja fornecido (Branch Default Parameter)", async () => {
      vi.mocked(mockPrisma.usuarioSetor.create).mockResolvedValueOnce({} as any);

      await service.vincularUsuarioSetor(mockPrisma, usuarioId, {
        setorId: "set-2",
        // papelId não foi enviado propositalmente
      });

      expect(mockPrisma.usuarioSetor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { usuarioId, setorId: "set-2", papelId: null },
        })
      );
    });

    it("deve interceptar erro P2002 do Prisma e lançar erro 409 de conflito (Branch Catch Específico)", async () => {
      // Para o 'instanceof Prisma.PrismaClientKnownRequestError' funcionar no service,
      // precisamos instanciar a classe original do pacote do Prisma.
      const erroP2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "4.x" }
      );
      vi.mocked(mockPrisma.usuarioSetor.create).mockRejectedValueOnce(erroP2002);

      const promise = service.vincularUsuarioSetor(mockPrisma, usuarioId, { setorId: "set-1" });

      // Verificamos rigorosamente se o erro possui a mensagem e o statusCode customizado
      await expect(promise).rejects.toMatchObject({
        message: "Vínculo já existente.",
        statusCode: 409,
      });
    });

    it("deve repassar qualquer outro erro genérico sem alterar (Branch Catch Default)", async () => {
      const erroDesconhecido = new Error("Erro de conexão no banco");
      vi.mocked(mockPrisma.usuarioSetor.create).mockRejectedValueOnce(erroDesconhecido);

      const promise = service.vincularUsuarioSetor(mockPrisma, usuarioId, { setorId: "set-1" });

      await expect(promise).rejects.toThrow("Erro de conexão no banco");
    });
  });

  // ============================================================================
  // SUÍTE: alterarPapelUsuarioSetor
  // ============================================================================
  describe("alterarPapelUsuarioSetor", () => {
    const usuarioSetorId = "vinc-123";

    it("deve atualizar com o papelId fornecido (Branch papelId string)", async () => {
      vi.mocked(mockPrisma.usuarioSetor.update).mockResolvedValueOnce({ atualizado: true } as any);

      await service.alterarPapelUsuarioSetor(mockPrisma, usuarioSetorId, { papelId: "novo-papel" });

      expect(mockPrisma.usuarioSetor.update).toHaveBeenCalledWith({
        where: { id: usuarioSetorId },
        data: { papelId: "novo-papel" },
        include: { setor: true, papel: true },
      });
    });

    it("deve atualizar com null se papelId não for fornecido (Branch Nullish Coalescing '??')", async () => {
      vi.mocked(mockPrisma.usuarioSetor.update).mockResolvedValueOnce({} as any);

      // Simulando ausência do campo no body (undefined)
      await service.alterarPapelUsuarioSetor(mockPrisma, usuarioSetorId, { papelId: undefined });

      expect(mockPrisma.usuarioSetor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { papelId: null },
        })
      );
    });
  });

  // ============================================================================
  // SUÍTE: desvincularUsuarioSetor
  // ============================================================================
  describe("desvincularUsuarioSetor", () => {
    it("deve deletar o vínculo corretamente", async () => {
      vi.mocked(mockPrisma.usuarioSetor.delete).mockResolvedValueOnce({ id: "123" } as any);

      await service.desvincularUsuarioSetor(mockPrisma, "123");

      expect(mockPrisma.usuarioSetor.delete).toHaveBeenCalledTimes(1);
      expect(mockPrisma.usuarioSetor.delete).toHaveBeenCalledWith({ where: { id: "123" } });
    });
  });

  // ============================================================================
  // SUÍTE: listarUsuariosDoSetor
  // ============================================================================
  describe("listarUsuariosDoSetor", () => {
    const setorId = "set-1";

    it("deve listar usando paginação default e sem filtro de busca (Branch Defaults e sem Search)", async () => {
      const mockData = [{ id: 1 }, { id: 2 }];
      const mockTotal = 2;
      vi.mocked(mockPrisma.usuarioSetor.findMany).mockResolvedValueOnce(mockData as any);
      vi.mocked(mockPrisma.usuarioSetor.count).mockResolvedValueOnce(mockTotal);

      const resultado = await service.listarUsuariosDoSetor(mockPrisma, setorId, {});

      // Validações matemáticas da paginação Padrão (page 1, perPage 20 -> skip 0, take 20)
      expect(mockPrisma.usuarioSetor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { setorId, usuario: {} }, // Confirmando o 'whereUsuario' vazio
        })
      );
      
      expect(resultado).toStrictEqual({ data: mockData, total: mockTotal, page: 1, perPage: 20 });
    });

    it("deve listar aplicando os cálculos de paginação customizada e query de busca (Branch Search e Math)", async () => {
      vi.mocked(mockPrisma.usuarioSetor.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(mockPrisma.usuarioSetor.count).mockResolvedValueOnce(0);

      // Solicitando página 3, com 10 itens por página.
      // (3 - 1) * 10 = skip 20
      await service.listarUsuariosDoSetor(mockPrisma, setorId, {
        page: 3,
        perPage: 10,
        search: "João",
      });

      // Validamos se o "OR" do Prisma foi montado corretamente quando há "search"
      const expectedWhere = {
        setorId,
        usuario: {
          OR: [
            { nome: { contains: "João", mode: "insensitive" } },
            { emailPessoal: { contains: "João", mode: "insensitive" } },
            { emailEducacional: { contains: "João", mode: "insensitive" } },
            { ra: { contains: "João", mode: "insensitive" } },
          ],
        },
      };

      expect(mockPrisma.usuarioSetor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
          where: expectedWhere,
        })
      );
      
      expect(mockPrisma.usuarioSetor.count).toHaveBeenCalledWith({ where: expectedWhere });
    });
  });

  // ============================================================================
  // SUÍTE: listarSetoresDoUsuario
  // ============================================================================
  describe("listarSetoresDoUsuario", () => {
    const usuarioId = "user-XYZ";

    it("deve listar com paginação default corretamente (Branch Defaults)", async () => {
      vi.mocked(mockPrisma.usuarioSetor.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(mockPrisma.usuarioSetor.count).mockResolvedValueOnce(0);

      const resultado = await service.listarSetoresDoUsuario(mockPrisma, usuarioId, {});

      expect(mockPrisma.usuarioSetor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { usuarioId },
          skip: 0,
          take: 20,
        })
      );
      expect(resultado).toStrictEqual({ data: [], total: 0, page: 1, perPage: 20 });
    });

    it("deve aplicar paginação customizada corretamente (Branch Math)", async () => {
      vi.mocked(mockPrisma.usuarioSetor.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(mockPrisma.usuarioSetor.count).mockResolvedValueOnce(0);

      // Página 2, com 5 por página -> (2 - 1) * 5 = skip 5
      await service.listarSetoresDoUsuario(mockPrisma, usuarioId, {
        page: 2,
        perPage: 5,
      });

      expect(mockPrisma.usuarioSetor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        })
      );
    });
  });
});