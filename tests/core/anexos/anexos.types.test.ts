import { describe, it, expect } from 'vitest';

import {
    ParamsWithTicketIdSchema,
    ParamsWithAnexoIdSchema,
    TicketIdParamsSchema,
    AnexoIdParamsSchema,
    ListAnexosQuerySchema,
} from '../../../src/core/anexos/anexos.types';

describe('AnexosTypes', () => {

    describe('ParamsWithTicketIdSchema', () => {

    it('deve validar corretamente o id do chamado', () => {
        const valido = ParamsWithTicketIdSchema.safeParse({
            id: 'ticket-001',
        })

        const invalido = ParamsWithTicketIdSchema.safeParse({
            id: '',
        })

        expect(valido.success).toBe(true)
        expect(invalido.success).toBe(false)
    })

})

    describe('ParamsWithAnexoIdSchema', () => {

    it('deve validar corretamente o anexoId', () => {
        const valido = ParamsWithAnexoIdSchema.safeParse({
            anexoId: 'cmj1234567890123456789012',
        })

        const invalido = ParamsWithAnexoIdSchema.safeParse({
            anexoId: 'anexo-001',
        })

        expect(valido.success).toBe(true)
        expect(invalido.success).toBe(false)
    })

})

    describe('ListAnexosQuerySchema', () => {

    it('deve validar os parâmetros da listagem', () => {
        const resultado = ListAnexosQuerySchema.safeParse({
            query: {
                page: '0',
                size: '20',
            },
        })

        expect(resultado.success).toBe(true)
    })

})

    describe('AnexoIdParamsSchema', () => {

    it('deve validar os parâmetros do download', () => {
        const resultado = AnexoIdParamsSchema.safeParse({
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
        })

        expect(resultado.success).toBe(true)
    })

})

    it('deve validar os parâmetros do upload', () => {
        const resultado = TicketIdParamsSchema.safeParse({
            params: {
                id: 'ticket-001',
            },
        })

        expect(resultado.success).toBe(true)
    })

});