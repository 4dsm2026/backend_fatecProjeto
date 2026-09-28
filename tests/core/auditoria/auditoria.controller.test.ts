import { vi, describe, it, expect } from 'vitest'
import { AuditoriaController } from '../../../src/core/auditoria/auditoria.controller'
import { log } from 'console'

describe('AuditoriaController-test', () => {
    it('deve listar todos os logs de auditoria', async () => {
        const fakeService: any = {
            listar: vi.fn().mockResolvedValue([
                { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
            ])
        }

        const controller = new AuditoriaController(fakeService)

        const mockRequest: any = {}
        const mockReply: any = { code: vi.fn().mockReturnThis, send: vi.fn() }

        await controller.listar(mockRequest, mockReply)

        expect(fakeService.listar).toHaveBeenCalled()

        expect(mockReply.send).toHaveBeenCalledWith([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])
    })

    it('deve listar os logs de auditoria por usuário', async () => {
        const fakeService: any = {
            listarPorUsuario: vi.fn().mockResolvedValue([
                { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
            ])
        }
        const controller = new AuditoriaController(fakeService)

        const mockRequest: any = { params: { id: 'user-admin-88' } }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await controller.listarPorUsuario(mockRequest, mockReply)

        expect(fakeService.listarPorUsuario).toHaveBeenCalledWith('user-admin-88')

        expect(mockReply.send).toHaveBeenCalledWith([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])
    })


    it('Deve listar os logs de auditoria por periodo', async () => {

        const fakeService: any = {
            listarPorPeriodo: vi.fn().mockResolvedValue([
                { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
            ])
        }
        const controller = new AuditoriaController(fakeService)

        const mockRequest: any = { query: { inicio: '2026-01-01', fim: '2026-01-31' } }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await controller.listarPorPeriodo(mockRequest, mockReply)

        expect(fakeService.listarPorPeriodo).toHaveBeenCalledWith(
            new Date('2026-01-01'),
            new Date('2026-01-31')
        )


        expect(mockReply.send).toHaveBeenCalledWith([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])

    })


    it('deve registrar um novo log de auditoria', async () => {
        const fakeService: any = {
            registrar: vi.fn().mockResolvedValue({ id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' })
        }

        const controller = new AuditoriaController(fakeService)

        const mockRequest: any = {
            body: { acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        }
        const mockReply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() }

        await controller.registrar(mockRequest, mockReply)

        expect(fakeService.registrar).toHaveBeenCalledWith(mockRequest.body)

        expect(mockReply.code).toHaveBeenCalledWith(201)
        
        expect(mockReply.send).toHaveBeenCalledWith({ id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' })
    })

})