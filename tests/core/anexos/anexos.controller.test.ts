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
// mockar 'fs', o teste tentaria abrir um arquivo real no disco — e como o
// filePath vem de um service mockado, o caminho não existe (ENOENT
// assíncrono, que o try/catch do controller não pega). Cobrindo os dois
// formatos de import (default e nomeado) para não depender de qual interop
// o bundler está usando.
vi.mock('fs', () => ({
    default: {
        createReadStream: mockCreateReadStream,
    },
    createReadStream: mockCreateReadStream,
}))

import * as AnexosController from '../../../src/core/anexos/anexos.controller'

// afterEach no nível do ARQUIVO (não dentro de um describe específico): os
// 4 blocos de teste abaixo compartilham os mesmos mocks hoisted, e um
// afterEach preso a um describe não alcança describes irmãos. Sem isso, uma
// chamada bem-sucedida do 1º teste de um bloco "vaza" pro 2º teste do MESMO
// bloco, fazendo `expect(mock).not.toHaveBeenCalled()` falhar mesmo quando
// o controller se comportou certo.
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

// anexoId usado em todos os testes de download/token: precisa ser um CUID
// de verdade, porque ParamsWithAnexoIdSchema (anexos.types.ts real) exige
// z.string().cuid() e a validação roda de verdade nestes testes (não é
// mockada). Confirmado empiricamente com o Zod real antes de escrever isto.
const VALID_ANEXO_ID = 'cmj1234567890123456789012'

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

    // NOVO: uploadValidator usa ParamsWithTicketIdSchema (id: string().min(1)),
    // igual ao list() — mas até agora só list() tinha o teste equivalente.
    it('deve retornar 400 se os parâmetros forem inválidos (id do chamado vazio)', async () => {
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

        await AnexosController.upload(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(400)
        expect(mockAlunoSemAcessoAoChamado).not.toHaveBeenCalled()
        expect(mockCreateAnexo).not.toHaveBeenCalled()
    })

    // NOVO: upload() tem exatamente o mesmo check de acesso que list() já
    // testava, mas não tinha o teste equivalente.
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

        await AnexosController.upload(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(404)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'Chamado não encontrado',
        })
        expect(mockCreateAnexo).not.toHaveBeenCalled()
    })

    // NOVO: createAnexo() (anexos.service.ts real) lança 4 erros distintos,
    // cada um com .statusCode próprio (400/415/404/413). O catch do
    // controller já faz `e?.statusCode || 500` — mas isso nunca tinha sido
    // exercitado com um erro que REALMENTE carrega statusCode. O único teste
    // de erro existente usa um Error puro, sem statusCode, então só prova o
    // fallback (lado direito do ||), nunca o repasse de verdade (lado
    // esquerdo). Uma regressão que trocasse `e?.statusCode` por, digamos,
    // `e?.code`, passaria despercebida sem estes testes.
    const uploadServiceErrorCases = [
        {
            description:
                '400 quando o service lança "nenhum arquivo enviado" (statusCode 400)',
            statusCode: 400,
            message: 'Nenhum arquivo enviado.',
        },
        {
            description:
                '415 quando o service lança "tipo de arquivo não permitido" (statusCode 415)',
            statusCode: 415,
            message: 'Tipo de arquivo não permitido: image/svg+xml',
        },
        {
            description:
                '404 quando o service lança "chamado não encontrado" na checagem interna (statusCode 404)',
            statusCode: 404,
            message: 'Chamado não encontrado',
        },
        {
            description:
                '413 quando o service lança "arquivo excede o limite" (statusCode 413)',
            statusCode: 413,
            message: 'Arquivo excede o limite de 10MB.',
        },
    ]

    it.each(uploadServiceErrorCases)('$description', async ({ statusCode, message }) => {
        mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false)
        const serviceError = Object.assign(new Error(message), { statusCode })
        mockCreateAnexo.mockRejectedValueOnce(serviceError)

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

        expect(mockReply.code).toHaveBeenCalledWith(statusCode)
        expect(mockReply.send).toHaveBeenCalledWith({ error: message })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })

    it('deve retornar 500 se o Service lançar uma exceção sem statusCode (fallback)', async () => {
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
                anexoId: VALID_ANEXO_ID,
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
            VALID_ANEXO_ID,
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
                anexoId: VALID_ANEXO_ID,
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

    // NOVO: ParamsWithAnexoIdSchema exige z.string().cuid() de verdade
    // (anexos.types.ts real, validação NÃO mockada neste arquivo). Nenhum
    // teste existente exercitava esse formato de erro 400 especificamente
    // para download() — confirmei empiricamente com Zod real que
    // 'not-a-valid-cuid' é rejeitado antes de escrever este teste.
    it('deve retornar 400 se o anexoId não tiver formato de cuid válido', async () => {
        const mockRequest: any = {
            params: {
                anexoId: 'not-a-valid-cuid',
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

        expect(mockReply.code).toHaveBeenCalledWith(400)
        expect(mockGetAnexoForDownload).not.toHaveBeenCalled()
    })

    it('deve retornar 500 se o Service lançar uma exceção sem statusCode (fallback)', async () => {
        const mockError = new Error('Erro ao baixar o anexo')

        mockGetAnexoForDownload.mockRejectedValueOnce(mockError)

        const mockRequest: any = {
            params: {
                anexoId: VALID_ANEXO_ID,
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

    // NOVO: errMsg (helper compartilhado por list/upload/download) faz
    // `e instanceof Error ? e.message : String(e)`. Todo teste de erro até
    // aqui lançava um Error de verdade — o lado String(e) nunca rodou.
    it('converte um valor não-Error lançado pelo service para string (errMsg)', async () => {
        mockGetAnexoForDownload.mockRejectedValueOnce('falha inesperada, não é um Error')

        const mockRequest: any = {
            params: {
                anexoId: VALID_ANEXO_ID,
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
            error: 'falha inesperada, não é um Error',
        })
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
                anexoId: VALID_ANEXO_ID,
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
                anexoId: VALID_ANEXO_ID,
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
                anexoId: VALID_ANEXO_ID,
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

    // NOVO: o bloco compartilhado logo abaixo (anexoAccessHandlers) só
    // exercita erros COM statusCode e message. Esta função usa
    // `e?.statusCode || 500` e `e?.message ?? String(e)` — nenhum teste
    // ainda cobria o lado do fallback (statusCode/message ausentes) para
    // ESTA função especificamente. Um valor lançado sem nenhuma das duas
    // propriedades fecha as duas branches de uma vez.
    it('deve retornar 500 e converter para string quando getAnexoForDownload falha sem statusCode nem message', async () => {
        mockGetAnexoForDownload.mockRejectedValueOnce('falha genérica sem statusCode')

        const mockRequest: any = {
            params: {
                anexoId: VALID_ANEXO_ID,
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

        await AnexosController.generateDownloadTokenRoute(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(500)
        expect(mockReply.send).toHaveBeenCalledWith({
            error: 'falha genérica sem statusCode',
        })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })

})

// ---------------------------------------------------------------------------
// NOVO BLOCO: download() e generateDownloadTokenRoute() chamam a MESMA
// getAnexoForDownload() e têm o MESMO padrão de catch
// (`const code = e?.statusCode || 500`). getAnexoForDownload (anexos.service.ts
// real) pode lançar 3 erros distintos: 404 (anexo não existe no banco), 403
// (usuário sem acesso) e 404 (arquivo físico sumiu do disco — uma segunda
// causa DIFERENTE para o mesmo código HTTP, com mensagem diferente). Nenhum
// desses 3 cenários tinha teste em NENHUMA das duas funções antes.
//
// Uma tabela × dois handlers via describe.each aninhado evita repetir 3
// blocos de teste quase idênticos 2 vezes (6 combinações a partir de 2
// tabelas pequenas, sem duplicação).
// ---------------------------------------------------------------------------
const downloadServiceErrorCases = [
    {
        description: '404 quando o anexo não existe no banco',
        statusCode: 404,
        message: 'Anexo não encontrado',
    },
    {
        description: '403 quando o usuário não tem acesso a este anexo',
        statusCode: 403,
        message: 'Acesso negado a este anexo',
    },
    {
        description: '404 quando o arquivo físico não existe mais no servidor',
        statusCode: 404,
        message: 'Arquivo físico não encontrado no servidor',
    },
]

const anexoAccessHandlers = [
    { name: 'download', handler: AnexosController.download },
    { name: 'generateDownloadTokenRoute', handler: AnexosController.generateDownloadTokenRoute },
]

describe.each(anexoAccessHandlers)('$name — repassa o statusCode de getAnexoForDownload', ({ handler }) => {
    it.each(downloadServiceErrorCases)('$description', async ({ statusCode, message }) => {
        const serviceError = Object.assign(new Error(message), { statusCode })
        mockGetAnexoForDownload.mockRejectedValueOnce(serviceError)

        const mockRequest: any = {
            params: {
                anexoId: VALID_ANEXO_ID,
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

        await handler(mockRequest, mockReply)

        expect(mockReply.code).toHaveBeenCalledWith(statusCode)
        expect(mockReply.send).toHaveBeenCalledWith({ error: message })
        expect(mockRequest.log.error).toHaveBeenCalled()
    })
})