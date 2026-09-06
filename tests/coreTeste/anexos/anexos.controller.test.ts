import { vi, describe, it, expect, afterEach } from 'vitest'

const {
    mockListAnexosByTicketId,
    mockAlunoSemAcessoAoChamado,
    mockCreateAnexo,
    mockGetAnexoForDownload,
    mockGenerateDownloadToken,
} = vi.hoisted(() => ({
    mockListAnexosByTicketId: vi.fn(),
    mockAlunoSemAcessoAoChamado: vi.fn(),
    mockCreateAnexo: vi.fn(),
    mockGetAnexoForDownload: vi.fn(),
    mockGenerateDownloadToken: vi.fn(),
}))

vi.mock('../../../src/core/anexos/anexos.service', () => ({
    listAnexosByTicketId: mockListAnexosByTicketId,
    createAnexo: mockCreateAnexo,
    getAnexoForDownload: mockGetAnexoForDownload,
}))

vi.mock('../../../src/core/tickets/tickets.service', () => ({
    alunoSemAcessoAoChamado: mockAlunoSemAcessoAoChamado,
}))

vi.mock('../../../src/utils/jwt', () => ({
    generateDownloadToken: mockGenerateDownloadToken,
}))

import * as AnexosController from '../../../src/core/anexos/anexos.controller'

const mockPrismaClient = {} as any

const mockAnexos = [
    {
        id: 'cmj1234567890123456789012',
        nomeArquivo: 'documento.pdf',
        mimeType: 'application/pdf',
        tamanhoBytes: 1024,
        enviadoEm: new Date(),
        enviadoPor: {
            id: 'user-001',
            nome: 'Usuário Teste',
        },
    },
]

describe('AnexosController - Listagem (GET /tickets/:id/anexos)', () => {
    afterEach(() => {
        vi.resetAllMocks()
    })

    it('deve listar os anexos do chamado e retornar 200', async () => {
        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)
        mockListAnexosByTicketId.mockResolvedValueOnce(mockAnexos)

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.list(mockRequest, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith(mockAnexos)
        expect(mockListAnexosByTicketId).toHaveBeenCalledWith(
            mockPrismaClient,
            'ticket-001'
        )
    })

    it('deve retornar 400 se os parâmetros forem inválidos', async () => {
        const mockRequest: any = {
            params: {
                id: '',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(400)
        expect(mockListAnexosByTicketId).not.toHaveBeenCalled()
    })

    it('deve retornar 404 se o usuário não tiver acesso ao chamado', async () => {
        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(true)

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(404)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Chamado não encontrado',
        })
        expect(mockListAnexosByTicketId).not.toHaveBeenCalled()
    })

    it('deve retornar 404 se o Service lançar erro P2025', async () => {
        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)
        mockListAnexosByTicketId.mockRejectedValueOnce({
            code: 'P2025',
            message: 'Registro não encontrado',
        })

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(404)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Chamado não encontrado',
        })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })

    it('deve retornar 500 se o Service lançar uma exceção não tratada', async () => {
        const mockError = new Error('Database connection failed')

        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)
        mockListAnexosByTicketId.mockRejectedValueOnce(mockError)

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.list(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: mockError.message,
        })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })
})
//Bloco Upload (POST /tickets/:id/anexos)

describe('AnexosController - Upload (POST /tickets/:id/anexos)', () => {

    it('deve criar um anexo e retornar 201', async () => {
        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)

        const mockAnexo = {
            id: 'anexo-002',
            nomeArquivo: 'documento.pdf',
            mimeType: 'application/pdf',
            tamanhoBytes: 1024,
        }

        mockCreateAnexo.mockResolvedValueOnce(mockAnexo)

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.upload(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(201)
        expect(mockReply.send).toHaveBeenCalledWith(mockAnexo)
        expect(mockCreateAnexo).toHaveBeenCalledWith(
            mockPrismaClient,
            mockRequest,
            'ticket-001',
            'user-001'
        )
    })

    it('deve retornar 401 se o usuário não estiver autenticado', async () => {
        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: undefined,
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.upload(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(401)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Não autenticado',
        })
        expect(mockCreateAnexo).not.toHaveBeenCalled()
    })

    it('deve retornar 500 se o Service lançar uma exceção não tratada', async () => {
        const mockError = new Error('Erro ao salvar o anexo')

        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)
        mockCreateAnexo.mockRejectedValueOnce(mockError)

        const mockRequest: any = {
            params: {
                id: 'ticket-001',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.upload(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: mockError.message,
        })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })
})

//Bloco Download (GET /anexos/:anexoId/download)
describe('AnexosController - Download (GET /anexos/:anexoId/download)', () => {

    it('deve baixar o anexo corretamente', async () => {
        const mockStream = {}
        
        mockGetAnexoForDownload.mockResolvedValueOnce({
            filePath: '/uploads/documento.pdf',
            fileName: 'documento.pdf',
            mimeType: 'application/pdf',
        })

        const mockRequest: any = {
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            header: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.download(mockRequest, mockReply)

        expect(mockGetAnexoForDownload).toHaveBeenCalledWith(
            mockPrismaClient,
            'cmj1234567890123456789012',
            'user-001',
            'ALUNO'
        )

        expect(mockReply.header).toHaveBeenCalled()
        expect(mockReply.send).toHaveBeenCalled()

    })
    

    it('deve retornar 401 se o usuário não estiver autenticado', async () => {
        const mockRequest: any = {
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: undefined,
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            header: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.download(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(401)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Não autenticado',
        })
        expect(mockGetAnexoForDownload).not.toHaveBeenCalled()
    })

    it('deve retornar 500 se o Service lançar uma exceção não tratada', async () => {
        const mockError = new Error('Erro ao baixar o anexo')

        mockGetAnexoForDownload.mockRejectedValueOnce(mockError)

        const mockRequest: any = {
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            header: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.download(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: mockError.message,
        })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })
})

//Bloco Generate Download Token (GET /anexos/:anexoId/download-token)

describe('AnexosController - Geração de Token (POST /anexos/:anexoId/download-token)', () => {

    it('deve gerar um token de download e retornar 200', async () => {
        mockGetAnexoForDownload.mockResolvedValueOnce({
            filePath: '/uploads/documento.pdf',
            fileName: 'documento.pdf',
            mimeType: 'application/pdf',
        })

        mockGenerateDownloadToken.mockReturnValueOnce('token-teste')

        const mockRequest: any = {
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.generateDownloadTokenRoute(
            mockRequest,
            mockReply
        )

        expect(mockGenerateDownloadToken).toHaveBeenCalledWith(
            {
                sub: 'user-001',
                anexoId: 'cmj1234567890123456789012',
            },
            {
                expiresIn: '5m',
            }
        )

        expect(mockReply.send).toHaveBeenCalledWith({
            token: 'token-teste',
            expiresIn: 300,
        })
    })

    it('deve retornar 401 se o usuário não estiver autenticado', async () => {
        const mockRequest: any = {
            params: {
                anexoId: 'cmj1234567890123456789012',
            },
            server: {
                prisma: mockPrismaClient,
            },
            user: undefined,
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.generateDownloadTokenRoute(
            mockRequest,
            mockReply
        )

        expect(mockReply.code).toHaveBeenCalledWith(401)

        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Não autenticado',
        })

        expect(mockGenerateDownloadToken).not.toHaveBeenCalled()
    })

    it('deve retornar 400 se o anexoId não for informado', async () => {
        const mockRequest: any = {
            params: {},
            server: {
                prisma: mockPrismaClient,
            },
            user: {
                sub: 'user-001',
                role: 'ALUNO',
            },
            log: {
                error: vi.fn(),
            },
        }

        const mockReply: any = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn(),
        }

        await AnexosController.generateDownloadTokenRoute(
            mockRequest,
            mockReply
        )

        expect(mockReply.code).toHaveBeenCalledWith(400)

        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Parâmetro anexoId ausente',
        })

        expect(mockGenerateDownloadToken).not.toHaveBeenCalled()
    })

})