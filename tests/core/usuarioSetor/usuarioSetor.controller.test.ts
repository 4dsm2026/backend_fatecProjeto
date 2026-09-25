import { vi, describe, beforeEach, it, expect } from "vitest";
import { FastifyRequest, FastifyReply } from "fastify";

// Imports com os caminhos corretos fornecidos
import * as controller from "../../../src/core/usuario-setor/usuarioSetor.controller";
import * as service from "../../../src/core/usuario-setor/usuarioSetor.service";

// ============================================================================
// 1. MOCKS DE DEPENDÊNCIAS
// ============================================================================

const mocksContext = vi.hoisted(() => ({
  validatorReturn: {} as any,
}));

// Atenção: Ajuste os caminhos relativos abaixo caso a pasta utils/validators
// esteja em um nível diferente da pasta core.
vi.mock("../../../src/utils/zod-helpers", () => ({
  buildRouteValidator: vi.fn(() => ({
    parse: vi.fn(() => mocksContext.validatorReturn),
  })),
}));

vi.mock("../../../src/validators/usuario-setor", () => ({
  VincularUsuarioSetorSchema: { shape: { params: {}, body: {} } },
  AlterarPapelUsuarioSetorSchema: { shape: { params: {}, body: {} } },
  ListUsuariosDoSetorSchema: { shape: { params: {}, query: {} } },
  ListSetoresDoUsuarioSchema: { shape: { params: {}, query: {} } },
}));

// O caminho do vi.mock DEVE ser idêntico ao caminho do import acima
vi.mock("../../../src/core/usuario-setor/usuarioSetor.service", () => ({
  vincularUsuarioSetor: vi.fn(),
  alterarPapelUsuarioSetor: vi.fn(),
  desvincularUsuarioSetor: vi.fn(),
  listarUsuariosDoSetor: vi.fn(),
  listarSetoresDoUsuario: vi.fn(),
}));

// ============================================================================
// 2. FUNÇÕES AUXILIARES PARA SETUP DO FASTIFY
// ============================================================================

function setupFastifyMocks(overrides: Partial<FastifyRequest> = {}) {
  const mockSend = vi.fn().mockResolvedValue(undefined);
  const mockCode = vi.fn().mockReturnValue({ send: mockSend });
  const mockLogError = vi.fn();
  
  // Extraímos a referência do prisma para podermos validá-la no expect 
  // sem causar o erro ts(2339) no req.server.prisma
  const prismaMock = { mockDb: true };

  const req = {
    server: { prisma: prismaMock },
    log: { error: mockLogError },
    params: {},
    body: {},
    query: {},
    ...overrides,
  } as unknown as FastifyRequest;

  const res = {
    code: mockCode,
    send: mockSend,
  } as unknown as FastifyReply;

  return { req, res, mockCode, mockSend, mockLogError, prismaMock };
}

// ============================================================================
// 3. SUÍTE DE TESTES UNITÁRIOS
// ============================================================================

describe("UsuarioSetor Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------------
  // vincular()
  // ----------------------------------------------------------------------
  describe("vincular", () => {
    it("deve retornar 400 se a validação (buildRouteValidator) falhar", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      const erroValidacao = { issues: ["Dados inválidos"] };
      mocksContext.validatorReturn = { error: erroValidacao };

      await controller.vincular(req, res);

      expect(mockCode).toHaveBeenCalledWith(400);
      expect(mockSend).toHaveBeenCalledWith(erroValidacao);
      expect(service.vincularUsuarioSetor).not.toHaveBeenCalled();
    });

    it("deve retornar 201 e o resultado do serviço em caso de sucesso", async () => {
      const { req, res, mockCode, mockSend, prismaMock } = setupFastifyMocks();
      
      // 'as any' resolve o ts(2345) do VS Code. O controller só precisa saber 
      // que o serviço retorna 'algo' e que esse 'algo' é enviado no res.send()
      const mockResult = { id: "123", role: "ADMIN" } as any; 
      
      mocksContext.validatorReturn = {
        data: { params: { usuarioId: "user-1" }, body: { setorId: "setor-1" } },
      };
      vi.mocked(service.vincularUsuarioSetor).mockResolvedValueOnce(mockResult);

      await controller.vincular(req, res);

      // Usar prismaMock diretamente resolve o ts(2339)
      expect(service.vincularUsuarioSetor).toHaveBeenCalledWith(
        prismaMock,
        "user-1",
        { setorId: "setor-1" }
      );
      expect(mockCode).toHaveBeenCalledWith(201);
      expect(mockSend).toHaveBeenCalledWith(mockResult);
    });

    it("deve retornar 409 se o serviço lançar um erro com statusCode === 409 (ex: Conflito)", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      mocksContext.validatorReturn = {
        data: { params: { usuarioId: "user-1" }, body: {} },
      };
      
      const conflictError = { statusCode: 409, message: "Usuário já vinculado a este setor" };
      vi.mocked(service.vincularUsuarioSetor).mockRejectedValueOnce(conflictError);

      await controller.vincular(req, res);

      expect(mockCode).toHaveBeenCalledWith(409);
      expect(mockSend).toHaveBeenCalledWith({ error: "Usuário já vinculado a este setor" });
    });

    it("deve retornar 500, logar o erro e tratar erro do tipo Error", async () => {
      const { req, res, mockCode, mockSend, mockLogError } = setupFastifyMocks();
      mocksContext.validatorReturn = { data: { params: {}, body: {} } };
      
      const standardError = new Error("Erro catastrófico no BD");
      vi.mocked(service.vincularUsuarioSetor).mockRejectedValueOnce(standardError);

      await controller.vincular(req, res);

      expect(mockLogError).toHaveBeenCalledWith({ e: standardError }, "💥 Erro ao vincular usuário ao setor");
      expect(mockCode).toHaveBeenCalledWith(500);
      expect(mockSend).toHaveBeenCalledWith({ error: "Erro catastrófico no BD" });
    });
  });

  // ----------------------------------------------------------------------
  // alterarPapel()
  // ----------------------------------------------------------------------
  describe("alterarPapel", () => {
    it("deve retornar 400 se a validação falhar", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      mocksContext.validatorReturn = { error: "Erro no body Zod" };

      await controller.alterarPapel(req, res);

      expect(mockCode).toHaveBeenCalledWith(400);
      expect(mockSend).toHaveBeenCalledWith("Erro no body Zod");
    });

    it("deve retornar 200 (chamando res.send direto) em caso de sucesso", async () => {
      const { req, res, mockSend, prismaMock } = setupFastifyMocks();
      const mockResult = { atualizado: true } as any;
      
      mocksContext.validatorReturn = {
        data: { params: { usuarioSetorId: "vinc-1" }, body: { papel: "USER" } },
      };
      vi.mocked(service.alterarPapelUsuarioSetor).mockResolvedValueOnce(mockResult);

      await controller.alterarPapel(req, res);

      expect(service.alterarPapelUsuarioSetor).toHaveBeenCalledWith(
        prismaMock,
        "vinc-1",
        { papel: "USER" }
      );
      expect(mockSend).toHaveBeenCalledWith(mockResult);
    });

    it("deve retornar 404 se o Prisma lançar exceção com code 'P2025'", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      mocksContext.validatorReturn = { data: { params: {}, body: {} } };
      
      const prismaError = { code: "P2025" };
      vi.mocked(service.alterarPapelUsuarioSetor).mockRejectedValueOnce(prismaError);

      await controller.alterarPapel(req, res);

      expect(mockCode).toHaveBeenCalledWith(404);
      expect(mockSend).toHaveBeenCalledWith({ error: "Vínculo não encontrado" });
    });

    it("deve retornar 500 e formatar um erro não instanciado como Error", async () => {
      const { req, res, mockCode, mockSend, mockLogError } = setupFastifyMocks();
      mocksContext.validatorReturn = { data: { params: {}, body: {} } };
      
      const erroEstranhoLiteral = "Uma string arremessada ao invés de um Error object";
      vi.mocked(service.alterarPapelUsuarioSetor).mockRejectedValueOnce(erroEstranhoLiteral);

      await controller.alterarPapel(req, res);

      expect(mockLogError).toHaveBeenCalled();
      expect(mockCode).toHaveBeenCalledWith(500);
      expect(mockSend).toHaveBeenCalledWith({ error: erroEstranhoLiteral });
    });
  });

  // ----------------------------------------------------------------------
  // desvincular()
  // ----------------------------------------------------------------------
  describe("desvincular", () => {
    it("deve retornar 400 se o usuarioSetorId for ausente nos parâmetros da rota", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks({ params: {} });

      await controller.desvincular(req, res);

      expect(mockCode).toHaveBeenCalledWith(400);
      expect(mockSend).toHaveBeenCalledWith({ error: "usuarioSetorId obrigatório" });
      expect(service.desvincularUsuarioSetor).not.toHaveBeenCalled();
    });

    it("deve retornar 204 em caso de sucesso ao desvincular", async () => {
      const { req, res, mockCode, mockSend, prismaMock } = setupFastifyMocks({
        params: { usuarioSetorId: "vinc-123" },
      });
      
      vi.mocked(service.desvincularUsuarioSetor).mockResolvedValueOnce(undefined as never);

      await controller.desvincular(req, res);

      expect(service.desvincularUsuarioSetor).toHaveBeenCalledWith(
        prismaMock,
        "vinc-123"
      );
      expect(mockCode).toHaveBeenCalledWith(204);
      expect(mockSend).toHaveBeenCalledWith();
    });

    it("deve retornar 404 se tentar desvincular e o Prisma disparar 'P2025'", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks({
        params: { usuarioSetorId: "vinc-123" },
      });
      
      vi.mocked(service.desvincularUsuarioSetor).mockRejectedValueOnce({ code: "P2025" });

      await controller.desvincular(req, res);

      expect(mockCode).toHaveBeenCalledWith(404);
      expect(mockSend).toHaveBeenCalledWith({ error: "Vínculo não encontrado" });
    });

    it("deve retornar 500 em caso de falha genérica na remoção", async () => {
      const { req, res, mockCode, mockLogError } = setupFastifyMocks({
        params: { usuarioSetorId: "vinc-123" },
      });
      
      const genericError = new Error("Deadlock BD");
      vi.mocked(service.desvincularUsuarioSetor).mockRejectedValueOnce(genericError);

      await controller.desvincular(req, res);

      expect(mockLogError).toHaveBeenCalledWith({ e: genericError }, "💥 Erro ao desvincular usuário do setor");
      expect(mockCode).toHaveBeenCalledWith(500);
    });
  });

  // ----------------------------------------------------------------------
  // listUsuariosDoSetor()
  // ----------------------------------------------------------------------
  describe("listUsuariosDoSetor", () => {
    it("deve retornar 400 em erro de validação", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      mocksContext.validatorReturn = { error: { issue: "Query page deve ser número" } };

      await controller.listUsuariosDoSetor(req, res);

      expect(mockCode).toHaveBeenCalledWith(400);
      expect(mockSend).toHaveBeenCalledWith({ issue: "Query page deve ser número" });
    });

    it("deve retornar 200 (send direto) com os itens listados", async () => {
      const { req, res, mockSend, prismaMock } = setupFastifyMocks();
      const mockResult = [{ id: 1, name: "Usuário X" }] as any;
      
      mocksContext.validatorReturn = {
        data: { params: { setorId: "setor-A" }, query: { page: 1 } },
      };
      vi.mocked(service.listarUsuariosDoSetor).mockResolvedValueOnce(mockResult);

      await controller.listUsuariosDoSetor(req, res);

      expect(service.listarUsuariosDoSetor).toHaveBeenCalledWith(
        prismaMock,
        "setor-A",
        { page: 1 }
      );
      expect(mockSend).toHaveBeenCalledWith(mockResult);
    });

    it("deve retornar 500 se o serviço disparar erro", async () => {
      const { req, res, mockCode, mockLogError } = setupFastifyMocks();
      mocksContext.validatorReturn = { data: { params: {}, query: {} } };
      
      vi.mocked(service.listarUsuariosDoSetor).mockRejectedValueOnce(new Error("Timeout"));

      await controller.listUsuariosDoSetor(req, res);

      expect(mockLogError).toHaveBeenCalled();
      expect(mockCode).toHaveBeenCalledWith(500);
    });
  });

  // ----------------------------------------------------------------------
  // listSetoresDoUsuario()
  // ----------------------------------------------------------------------
  describe("listSetoresDoUsuario", () => {
    it("deve retornar 400 em erro de validação", async () => {
      const { req, res, mockCode, mockSend } = setupFastifyMocks();
      mocksContext.validatorReturn = { error: "Param inválido" };

      await controller.listSetoresDoUsuario(req, res);

      expect(mockCode).toHaveBeenCalledWith(400);
      expect(mockSend).toHaveBeenCalledWith("Param inválido");
    });

    it("deve retornar 200 (send direto) com os dados", async () => {
      const { req, res, mockSend, prismaMock } = setupFastifyMocks();
      const mockResult = [{ id: 2, name: "Setor Financeiro" }] as any;
      
      mocksContext.validatorReturn = {
        data: { params: { usuarioId: "user-XYZ" }, query: { limit: 10 } },
      };
      vi.mocked(service.listarSetoresDoUsuario).mockResolvedValueOnce(mockResult);

      await controller.listSetoresDoUsuario(req, res);

      expect(service.listarSetoresDoUsuario).toHaveBeenCalledWith(
        prismaMock,
        "user-XYZ",
        { limit: 10 }
      );
      expect(mockSend).toHaveBeenCalledWith(mockResult);
    });

    it("deve retornar 500 se o serviço disparar erro genérico", async () => {
      const { req, res, mockCode, mockLogError } = setupFastifyMocks();
      mocksContext.validatorReturn = { data: { params: {}, query: {} } };
      
      vi.mocked(service.listarSetoresDoUsuario).mockRejectedValueOnce(new Error("Down"));

      await controller.listSetoresDoUsuario(req, res);

      expect(mockLogError).toHaveBeenCalled();
      expect(mockCode).toHaveBeenCalledWith(500);
    });
  });
});