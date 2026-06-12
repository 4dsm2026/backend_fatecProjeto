import { vi, describe, it, expect, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client';

// vi.hoisted ensures the variable is available when the vi.mock factory runs
const { mockCreateTicket } = vi.hoisted(() => ({
  mockCreateTicket: vi.fn(),
}));

vi.mock('../../src/core/tickets/tickets.service', () => ({
  createTicket: mockCreateTicket,
  getTicketById: vi.fn(),
  listTickets: vi.fn(),
  updateTicket: vi.fn(),
  softDeleteTicket: vi.fn(),
}));

import * as NotifyModule from '../../src/core/notifications/notify';
import * as TicketController from '../../src/core/tickets/tickets.controller';

const MOCK_CRIADOR_ID = 'user-creator-id-123';
const MOCK_ORGANIZACAO_ID = 'org-id-001';
const mockPrismaClient = {} as PrismaClient;
const mockNotifyMany = vi.spyOn(NotifyModule, 'notifyMany').mockResolvedValue(undefined as any);

const mockCreatedTicket = {
  id: 'tck-007',
  titulo: 'Problema com Acesso',
  protocolo: 'TCK-ABCDE',
  descricao: 'Não consigo logar no sistema X.',
  status: 'ABERTO',
  nivel: 'N1',
  prioridade: 'MEDIA',
  criadoPorId: MOCK_CRIADOR_ID,
  organizacaoId: MOCK_ORGANIZACAO_ID,
  servicoId: 'svc-1',
  setorId: null,
  responsavelId: null,
  criadoEm: new Date(),
  servico: { id: 'svc-1', nome: 'Acesso e Login' },
  criadoPor: { id: MOCK_CRIADOR_ID, nome: 'User Teste' },
};

describe('TicketController - Criação (POST /tickets)', () => {

  afterEach(() => {
    vi.clearAllMocks();
    mockCreateTicket.mockClear();
  });

  it('deve criar um novo chamado com dados mínimos e retornar 201', async () => {
    mockCreateTicket.mockResolvedValueOnce(mockCreatedTicket as any);

    const requestBody = {
      titulo: 'Ticket Mínimo',
      descricao: 'Descrição mínima.',
      organizacaoId: MOCK_ORGANIZACAO_ID,
      servicoId: 'svc-1',
    };

    const mockRequest: any = {
      body: requestBody,
      server: { prisma: mockPrismaClient },
      log: { error: vi.fn() },
      user: { sub: MOCK_CRIADOR_ID },
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await TicketController.create(mockRequest, mockReply);

    expect(mockReply.code).toHaveBeenCalledWith(201);
    expect(mockReply.send).toHaveBeenCalledWith(mockCreatedTicket);
    expect(mockCreateTicket).toHaveBeenCalledWith(
      mockPrismaClient,
      expect.objectContaining(requestBody),
      expect.objectContaining({ feitoPorId: MOCK_CRIADOR_ID })
    );
  });

  it('deve retornar 401 se o usuário não estiver autenticado (falta req.user.sub)', async () => {
    const mockRequest: any = {
      body: { titulo: 'Falha', descricao: 'Falha' },
      server: { prisma: mockPrismaClient },
      log: { error: vi.fn() },
      user: undefined,
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await TicketController.create(mockRequest, mockReply);

    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(mockReply.code).toHaveBeenCalledWith(401);
    expect(mockReply.send).toHaveBeenCalledWith({ error: "Não autenticado" });
  });

  it('deve retornar 500 se o Service lançar uma exceção não tratada', async () => {
    const MOCK_ERROR = new Error("Database connection failed");
    mockCreateTicket.mockRejectedValueOnce(MOCK_ERROR);

    const mockRequest: any = {
      body: { titulo: 'Erro 500', descricao: 'Descrição do erro.', organizacaoId: MOCK_ORGANIZACAO_ID, servicoId: 'svc-1' },
      server: { prisma: mockPrismaClient },
      log: { error: vi.fn() },
      user: { sub: MOCK_CRIADOR_ID },
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await TicketController.create(mockRequest, mockReply);

    expect(mockReply.code).toHaveBeenCalledWith(500);
    expect(mockReply.send).toHaveBeenCalledWith({ error: MOCK_ERROR.message });
    expect(mockRequest.log.error).toHaveBeenCalled();
  });
});
