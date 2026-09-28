import { vi, describe, it, expect } from 'vitest'
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import * as MessagesService from '../../../src/core/ticket-messages/messages.service'
import * as TicketsService from '../../../src/core/tickets/tickets.service'
import { create, list } from '../../../src/core/ticket-messages/messages.controller'

describe('messages.controller', () => {

    it('deve criar uma mensagem com sucesso', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(false)
        vi.spyOn(MessagesService, 'createTicketMessage').mockResolvedValue({
            id: 'msg-1',
            chamadoId: 'chamado-1',
            autorId: 'user-1',
            conteudo: 'Preciso de ajuda',
            criadoEm: new Date('2026-01-01'),
            atualizadoEm: new Date('2026-01-01'),
            deletadoEm: null,
            autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
        })

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            body: { conteudo: 'Preciso de ajuda' },
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }

        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await create(mockRequest, mockReply)

        expect(MessagesService.createTicketMessage).toHaveBeenCalled()
        expect(mockReply.code).toHaveBeenCalledWith(201)
        expect(mockReply.send).toHaveBeenCalledWith({
            id: 'msg-1',
            chamadoId: 'chamado-1',
            autorId: 'user-1',
            conteudo: 'Preciso de ajuda',
            criadoEm: new Date('2026-01-01'),
            atualizadoEm: new Date('2026-01-01'),
            deletadoEm: null,
            autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
        })
    })

    it('deve retornar 400 quando o body é inválido', async () => {
        const mockRequest: any = {
            params: { id: 'chamado-1' },
            body: { conteudo: '' },
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await create(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(400)
    })

    it('deve retornar 401 quando não há usuário autenticado', async () => {
        const mockRequest: any = {
            params: { id: 'chamado-1' },
            body: { conteudo: 'Preciso de ajuda' },
            server: { prisma: prismaMock },
            user: undefined,
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await create(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(401)
    })

    it('deve retornar 404 quando o usuário não tem acesso ao chamado', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(true) // true = SEM acesso

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            body: { conteudo: 'Preciso de ajuda' },
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await create(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(404)
    })

    it('deve retornar 500 quando o service lança um erro inesperado', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(false)
        vi.spyOn(MessagesService, 'createTicketMessage').mockRejectedValue(new Error('Falha de conexão'))

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            body: { conteudo: 'Preciso de ajuda' },
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await create(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
    })

    it('deve listar as mensagens com sucesso', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(false)
        vi.spyOn(MessagesService, 'listTicketMessages').mockResolvedValue({
            total: 1,
            page: 1,
            pageSize: 100,
            mensagens: [
                {
                    id: 'msg-1', chamadoId: 'chamado-1', autorId: 'user-1', conteudo: 'Oi',
                    criadoEm: new Date('2026-01-01'), atualizadoEm: new Date('2026-01-01'), deletadoEm: null,
                    autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
                }
            ]
        })

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            query: {},
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await list(mockRequest, mockReply)

        expect(MessagesService.listTicketMessages).toHaveBeenCalled()
        expect(mockReply.send).toHaveBeenCalledWith({
            total: 1,
            page: 1,
            pageSize: 100,
            mensagens: [
                {
                    id: 'msg-1', chamadoId: 'chamado-1', autorId: 'user-1', conteudo: 'Oi',
                    criadoEm: new Date('2026-01-01'), atualizadoEm: new Date('2026-01-01'), deletadoEm: null,
                    autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
                }
            ]
        })
    })

    it('deve retornar 404 quando o usuário não tem acesso ao chamado (list)', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(true)

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            query: {},
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(404)
    })

    it('deve retornar 500 quando o service lança um erro inesperado (list)', async () => {
        vi.spyOn(TicketsService, 'alunoSemAcessoAoChamado').mockResolvedValue(false)
        vi.spyOn(MessagesService, 'listTicketMessages').mockRejectedValue(new Error('Falha de conexão'))

        const mockRequest: any = {
            params: { id: 'chamado-1' },
            query: {},
            server: { prisma: prismaMock },
            user: { sub: 'user-1', role: 'USUARIO' },
            log: { error: vi.fn() }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
    })
})






// pnpm vitest tests/core/ticket-messages/messages.controller.test.ts