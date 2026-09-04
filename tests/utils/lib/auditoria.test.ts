import { vi, describe, it, expect } from 'vitest'
vi.mock('../../../src/lib/prisma')
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { registrarAuditoria } from '../../../src/lib/auditoria'
import { error } from 'console'

describe('auditoria-tests', () => {

    it('Verificar se ele manda os dados para o banco', async () => {
        prismaMock.auditoria.create.mockResolvedValue({
            feitoPorId: 'user-admin-88',
            acao: 'CHAMADO_FECHADO',
            alvo: null,
            meta: null,
        })

        await registrarAuditoria({ acao: 'CHAMADO_FECHADO', alvo: null, feitoPorId: 'user-admin-88', meta: null })

        expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
            data: {
                acao: 'CHAMADO_FECHADO',
                alvo: null,
                feitoPorId: 'user-admin-88',
                meta: null
            }
        })
    })
    it('não deve lançar exceção quando o Prisma falha', async () => {
        prismaMock.auditoria.create.mockRejectedValue(new Error('Erro de conexão com o banco'))

        await expect(
            registrarAuditoria({
                acao: 'CHAMADO_FECHADO', alvo: null, feitoPorId: 'user-admin-88', meta: null
            })
        ).resolves.not.toThrow()



    })
})

// npx vitest run tests/utils/lib/auditoria.test.ts