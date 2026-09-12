import { vi, describe, it, expect } from 'vitest'
vi.mock('../../../src/lib/prisma')
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { AuditoriaService } from '../../../src/core/auditoria/auditoria.service'

describe('auditoriaService-tests', () => {



    //=====================================
    //==============REGISTRAR==============

    it('deve registrar um log de auditoria', async () => {
        prismaMock.auditoria.create.mockResolvedValue({
            id: '7',
            acao: 'CHAMADO_FECHADO',
            alvo: 'ticket-4521',
            feitoPorId: 'user-admin-88'
        })

        const service = new AuditoriaService()

        const resultado = await service.registrar({
            acao: 'CHAMADO_FECHADO',
            alvo: 'ticket-4521',
            feitoPorId: 'user-admin-88'
        })

        expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
            data: {
                acao: 'CHAMADO_FECHADO',
                alvo: 'ticket-4521',
                meta: undefined,
                feitoPorId: 'user-admin-88'
            }
        })

        expect(resultado).toEqual({
            id: '7',
            acao: 'CHAMADO_FECHADO',
            alvo: 'ticket-4521',
            feitoPorId: 'user-admin-88'
        })
    })




    it('deve propagar o erro quando o Prisma falha ao registrar', async () => {
        prismaMock.auditoria.create.mockRejectedValue(new Error('Erro de conexão com o banco'))

        const service = new AuditoriaService()

        await expect(
            service.registrar({ acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' })
        ).rejects.toThrow('Erro de conexão com o banco')
    })



    //====================================
    //===============LISTAR===============


    it('Deve listar todos os logs da auditoria', async () => {

        prismaMock.auditoria.findMany.mockResolvedValue([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' },
            { id: '2', acao: 'LOGIN_SUCESSO', alvo: null, feitoPorId: 'user-joao-12' }
        ])

        const service = new AuditoriaService()

        const resultadoLista = await service.listar()



        expect(prismaMock.auditoria.findMany).toHaveBeenCalledWith({
            orderBy: { feitoEm: "desc" },
            include: { feitoPor: true }
        })

        expect(resultadoLista).toEqual([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' },
            { id: '2', acao: 'LOGIN_SUCESSO', alvo: null, feitoPorId: 'user-joao-12' }
        ])
    })



    it('Deve Listar todos os logs da auditoria por ID', async () => {

        prismaMock.auditoria.findMany.mockResolvedValue([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])

        const service = new AuditoriaService()

        const resultadoListaId = await service.listarPorUsuario('user-admin-88')



        expect(prismaMock.auditoria.findMany).toHaveBeenCalledWith({
            where: { feitoPorId: 'user-admin-88' },
            orderBy: { feitoEm: "desc" },
            include: { feitoPor: true },
        })

        expect(resultadoListaId).toEqual([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88'}

        ])

    })


    it('Deve listar todos os logs da auditoria por periodo', async () => {

        prismaMock.auditoria.findMany.mockResolvedValue([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])

        const service = new AuditoriaService()

        const inicio = new Date('2026-01-01')
        const fim = new Date('2026-01-31')

        const resultadoLista = await service.listarPorPeriodo(inicio, fim)

        expect(prismaMock.auditoria.findMany).toHaveBeenCalledWith({
            where: {
                feitoEm: {
                    gte: inicio,
                    lte: fim,
                },
            },
            orderBy: { feitoEm: "desc" },
            include: { feitoPor: true },
        })

        expect(resultadoLista).toEqual([
            { id: '1', acao: 'CHAMADO_FECHADO', alvo: 'ticket-4521', feitoPorId: 'user-admin-88' }
        ])

    })




})








// npx vitest run test/coreTeste/auditoria/auditoria.test.ts

/*
um admin (user-admin-88) fechou o ticket ticket-4521; 
verificamos que o service registrou essa auditoria com os dados certos, 
e devolveu o registro criado.
*/