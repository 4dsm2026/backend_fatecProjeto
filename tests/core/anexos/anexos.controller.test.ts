import { vi, describe, it, expect, afterEach } from 'vitest'

const {
    mockListAnexosByTicketId,
    mockAlunoSemAcessoAoChamado,
    mockCreateAnexo,
    mockGetAnexoForDownload,
    mockGenerateDownloadToken,
    mockCreateReadStream,
} = vi.hoisted(() => ({
    mockListAnexosByTicketId: vi.fn(),
    mockAlunoSemAcessoAoChamado: vi.fn(),
    mockCreateAnexo: vi.fn(),
    mockGetAnexoForDownload: vi.fn(),
    mockGenerateDownloadToken: vi.fn(),
    mockCreateReadStream: vi.fn(),
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

// anexos.controller.ts faz `import fs from 'fs'` e chama
// `fs.createReadStream(filePath)` de verdade dentro de download(). Sem
// mockar o módulo 'fs', o teste tenta abrir o arquivo no disco de verdade
// — e como o filePath vem de um service mockado, o caminho não existe,
// gerando um ENOENT assíncrono que o try/catch do controller não pega
// (createReadStream falha via evento 'error' no stream, não por exceção
// síncrona). Cobrindo os dois formatos de import (default e nomeado) para
// não depender de qual interop o bundler está usando.
vi.mock('fs', () => ({
    default: {
        createReadStream: mockCreateReadStream,
    },
    createReadStream: mockCreateReadStream,
}))

import * as AnexosController from '../../../src/core/anexos/anexos.controller'

// ---------------------------------------------------------------------------
// CORREÇÃO: este afterEach estava declarado só dentro do describe
// "Listagem", então só se aplicava aos 5 testes daquele bloco (afterEach
// dentro de um describe NÃO alcança describes irmãos). Os blocos Upload,
// Download e Geração de Token nunca tinham os mocks resetados entre testes,
// então uma chamada bem-sucedida do 1º teste de cada bloco continuava
// "presa" no mock quando o 2º/3º teste do MESMO bloco rodava — fazendo
// `expect(mock).not.toHaveBeenCalled()` falhar mesmo quando o controller
// se comportou certo. Movendo para o nível do arquivo, todo describe abaixo
// passa a resetar os mocks depois de cada teste, sem precisar repetir o
// hook em cada bloco.
// ---------------------------------------------------------------------------
afterEach(() => {
    vi.resetAllMocks()
})

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
        mockGetAnexoForDownload.mockResolvedValueOnce({
            filePath: '/uploads/documento.pdf',
            fileName: 'documento.pdf',
            mimeType: 'application/pdf',
        })

        // Sem isso, o controller chamaria fs.createReadStream de verdade
        // com um caminho que não existe no ambiente de teste (ENOENT).
        const mockStream = { fake: 'stream' }
        mockCreateReadStream.mockReturnValueOnce(mockStream as any)

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

        expect(mockCreateReadStream).toHaveBeenCalledWith('/uploads/documento.pdf')

        // Valores exatos em vez de só "foi chamado": pega bug de header
        // trocado ou de formato errado no Content-Disposition.
        expect(mockReply.header).toHaveBeenNthCalledWith(
            1,
            'Content-Disposition',
            'attachment; filename="documento.pdf"'
        )
        expect(mockReply.header).toHaveBeenNthCalledWith(2, 'Content-Type', 'application/pdf')
        expect(mockReply.send).toHaveBeenCalledWith(mockStream)
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