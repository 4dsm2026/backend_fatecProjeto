import { describe, it, expect } from 'vitest';

import {
    ParamsWithTicketIdSchema,
    ParamsWithAnexoIdSchema,
    ListAnexosSchema,
    DownloadAnexoSchema,
    UploadAnexoSchema,
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

    describe('ListAnexosSchema', () => {

    it('deve validar os parâmetros da listagem', () => {
        const resultado = ListAnexosSchema.safeParse({
            params: {
                id: 'ticket-001',
            },
        })

        expect(resultado.success).toBe(true)
    })

})

    describe('DownloadAnexoSchema', () => {

    it('deve validar os parâmetros do download', () => {
        const resultado = DownloadAnexoSchema.safeParse({
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
        })

        expect(resultado.success).toBe(true)
    })

})

    it('deve validar os parâmetros do upload', () => {
        const resultado = UploadAnexoSchema.safeParse({
            params: {
                id: 'ticket-001',
            },
        })

        expect(resultado.success).toBe(true)
    })

});