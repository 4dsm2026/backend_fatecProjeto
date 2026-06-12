import { vi, describe, it, expect, afterEach } from 'vitest'
import * as UserController from '../../src/core/users/users.controller';
import * as UserService from '../../src/core/users/users.service';

describe('UserController', () => {
  const mockUserReturn = {
    id: '1',
    nome: 'João',
    emailPessoal: 'joao@teste.com',
    papel: 'USUARIO',
    ativo: true,
    senhaHash: 'senha_hash_simulado',
    organizacaoId: null,
    cursoNome: null,
    cursoSigla: null,
    emailEducacional: null,
    ra: null,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    deletadoEm: null,
    anonimizado: false,
    passwordUpdatedAt: null,
    loginAttempts: 0,
    lockedUntil: null,
    lastFailedAttempt: null,
    precisaTrocarSenha: false,
  };

  const mockUserServiceCreate = vi.spyOn(UserService, 'createUser').mockResolvedValue(mockUserReturn as any);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deve criar um novo usuário', async () => {
    const userData = {
      nome: 'João',
      emailPessoal: 'joao@teste.com',
      senha: 'senha123',
      papel: 'USUARIO' as const,
      ativo: true,
      organizacaoId: null,
    };

    const mockRequest: any = {
      body: userData,
      params: {},
      query: {},
      raw: {},
      headers: {},
      log: { info: vi.fn(), error: vi.fn() },
      server: {},
      ip: '127.0.0.1',
      req: {},
      host: 'localhost',
      id: 'mock-request-id',
    };

    const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    await UserController.create(mockRequest, mockReply);

    expect(mockUserServiceCreate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        nome: 'João',
        emailPessoal: 'joao@teste.com',
        papel: 'USUARIO',
        ativo: true,
        senha: 'senha123',
      }),
      expect.objectContaining({
        feitoPorId: undefined,
      })
    );

    expect(mockReply.code).toHaveBeenCalledWith(201);
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        nome: 'João',
        emailPessoal: 'joao@teste.com',
        papel: 'USUARIO',
        ativo: true,
        criadoEm: expect.any(Date),
        atualizadoEm: expect.any(Date),
      })
    );
  });
});
