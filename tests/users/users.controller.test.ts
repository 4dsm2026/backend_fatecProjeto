import { vi, describe, it, expect, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client';
import * as UserController from '../../src/core/users/users.controller';
import * as UserService from '../../src/core/users/users.service';

const mockPrismaClient = {} as PrismaClient;

describe('UserController', () => {
  const mockUserReturn = {
    id: '1', nome: 'João', emailPessoal: 'joao@teste.com', papel: 'USUARIO', ativo: true,
    senhaHash: 'senha_hash_simulado', organizacaoId: null, cursoNome: null, cursoSigla: null,
    emailEducacional: null, ra: null, criadoEm: new Date(), atualizadoEm: new Date(),
    deletadoEm: null, anonimizado: false, passwordUpdatedAt: null, loginAttempts: 0,
    lockedUntil: null, lastFailedAttempt: null, precisaTrocarSenha: false,
  };

  const mockUserReturnAluno = {
    ...mockUserReturn,
    id: '2',
    nome: 'Maria Aluna Fatec',
    emailPessoal: 'maria.aluna@email.com',
    emailEducacional: 'maria.a.silva@fatec.sp.gov.br',
    ra: '12345678',
    cursoNome: 'Desenvolvimento de Software Multiplataforma',
    cursoSigla: 'DSM',
  };

  const mockUserServiceCreate = vi.spyOn(UserService, 'createUser');

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deve criar um novo usuário padrão', async () => {
    mockUserServiceCreate.mockResolvedValueOnce(mockUserReturn as any);

    const userData = {
      nome: 'João', emailPessoal: 'joao@teste.com', senha: 'senha123',
      papel: 'USUARIO' as const, ativo: true, organizacaoId: null,
    };

    const mockRequest: any = {
      body: userData,
      server: { prisma: mockPrismaClient },
      params: {}, query: {}, raw: {}, headers: {},
      log: { info: vi.fn(), error: vi.fn() },
      ip: '127.0.0.1', req: {}, host: 'localhost', id: 'mock-request-id',
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await UserController.create(mockRequest, mockReply);

    expect(mockUserServiceCreate).toHaveBeenCalledWith(
      mockPrismaClient,
      expect.objectContaining({
        nome: 'João', emailPessoal: 'joao@teste.com', papel: 'USUARIO',
        ativo: true, senha: 'senha123', organizacaoId: null,
      }),
      expect.objectContaining({ feitoPorId: undefined })
    );

    expect(mockReply.code).toHaveBeenCalledWith(201);
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', nome: 'João', emailPessoal: 'joao@teste.com', papel: 'USUARIO' })
    );
  });

  it('deve criar um novo usuário Aluno Fatec (DSM) com RA e Email Educacional', async () => {
    mockUserServiceCreate.mockResolvedValueOnce(mockUserReturnAluno as any);

    const userDataAluno = {
      nome: 'Maria Aluna Fatec',
      emailPessoal: 'maria.aluna@email.com',
      emailEducacional: 'maria.a.silva@fatec.sp.gov.br',
      ra: '12345678',
      cursoNome: 'Desenvolvimento de Software Multiplataforma',
      cursoSigla: 'DSM' as const,
      senha: 'senha456', papel: 'USUARIO' as const, ativo: true,
      organizacaoId: null,
    };

    const mockRequest: any = {
      body: userDataAluno,
      server: { prisma: mockPrismaClient },
      log: { info: vi.fn(), error: vi.fn() },
      ip: '127.0.0.1',
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await UserController.create(mockRequest, mockReply);

    expect(mockUserServiceCreate).toHaveBeenCalledWith(
      mockPrismaClient,
      expect.objectContaining({
        nome: 'Maria Aluna Fatec',
        emailPessoal: 'maria.aluna@email.com',
        emailEducacional: 'maria.a.silva@fatec.sp.gov.br',
        ra: '12345678',
        senha: 'senha456',
        ativo: true,
        papel: 'USUARIO',
        organizacaoId: null,
      }),
      expect.objectContaining({ feitoPorId: undefined })
    );

    expect(mockReply.code).toHaveBeenCalledWith(201);
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '2',
        nome: 'Maria Aluna Fatec',
        emailPessoal: 'maria.aluna@email.com',
        emailEducacional: 'maria.a.silva@fatec.sp.gov.br',
        ra: '12345678',
        cursoNome: 'Desenvolvimento de Software Multiplataforma',
        cursoSigla: 'DSM',
      })
    );
  });
});
