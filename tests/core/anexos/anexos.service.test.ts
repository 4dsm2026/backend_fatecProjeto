import { vi, describe, it, expect, afterEach } from 'vitest'

const {
    mockPrisma,
} = vi.hoisted(() => ({
    mockPrisma: {
        chamado: {
            findUniqueOrThrow: vi.fn(),
            findUnique: vi.fn(),
        },
        anexo: {
            findMany: vi.fn(),
            create: vi.fn(),
            findUnique: vi.fn(),
        },
        usuarioSetor: {
            findFirst: vi.fn(),
        },
    },
}))

vi.mock('../../../src/core/notifications/notify', () => ({
    notifyMany: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs/promises', () => ({
    default: {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        access: vi.fn(),
    },
}))

import * as AnexosService from '../../../src/core/anexos/anexos.service'

afterEach(() => {
    vi.resetAllMocks()
})

describe('AnexosService', () => {

    describe('listAnexosByTicketId()', () => {

        it('deve listar os anexos do chamado com sucesso', async () => {
            const chamadoId = 'chamado-001'

            const mockAnexos = [
                {
                    id: 'anexo-001',
                    nomeArquivo: 'documento.pdf',
                    mimeType: 'application/pdf',
                    tamanhoBytes: 1024,
                    enviadoEm: new Date(),
                    enviadoPor: {
                        id: 'user-001',
                        nome: 'Guilherme',
                    },
                },
            ]

            mockPrisma.chamado.findUniqueOrThrow.mockResolvedValueOnce({
                id: chamadoId,
            })

            mockPrisma.anexo.findMany.mockResolvedValueOnce(mockAnexos)

            const resultado = await AnexosService.listAnexosByTicketId(
                mockPrisma as any,
                chamadoId,
            )

            expect(resultado).toEqual(mockAnexos)

            expect(
                mockPrisma.chamado.findUniqueOrThrow,
            ).toHaveBeenCalledWith({
                where: { id: chamadoId },
            })

            expect(mockPrisma.anexo.findMany).toHaveBeenCalled()
        })

        it('deve lançar erro quando o chamado não existir', async () => {
            const chamadoId = 'chamado-inexistente'
            const erro = new Error('Chamado não encontrado')

            mockPrisma.chamado.findUniqueOrThrow.mockRejectedValueOnce(erro)

            await expect(
                AnexosService.listAnexosByTicketId(
                    mockPrisma as any,
                    chamadoId,
                ),
            ).rejects.toThrow('Chamado não encontrado')

            expect(
                mockPrisma.anexo.findMany,
            ).not.toHaveBeenCalled()
        })

        it('deve tratar erro ao buscar os anexos', async () => {
            const chamadoId = 'chamado-001'
            const erro = new Error('Erro ao consultar anexos')

            mockPrisma.chamado.findUniqueOrThrow.mockResolvedValueOnce({
                id: chamadoId,
            })

            mockPrisma.anexo.findMany.mockRejectedValueOnce(erro)

            await expect(
                AnexosService.listAnexosByTicketId(
                    mockPrisma as any,
                    chamadoId,
                ),
            ).rejects.toThrow('Erro ao consultar anexos')
        })
    })

    describe('createAnexo()', () => {

        it('deve criar um anexo com sucesso', async () => {
            const { notifyMany } = await import(
                '../../../src/core/notifications/notify'
            )

            vi.mocked(notifyMany).mockResolvedValue(undefined)

            const chamadoId = 'chamado-001'
            const userId = 'user-001'

            const mockReq = {
                file: vi.fn().mockResolvedValue({
                    filename: 'documento.pdf',
                    mimetype: 'application/pdf',
                    toBuffer: vi.fn().mockResolvedValue(
                        Buffer.from('conteudo do arquivo'),
                    ),
                }),
            } as any

            const mockChamado = {
                id: chamadoId,
                protocolo: 'CH-001',
                criadoPorId: 'user-002',
                responsavelId: 'user-003',
                organizacaoId: 'org-001',
            }

            const mockAnexo = {
                id: 'anexo-001',
                nomeArquivo: 'documento.pdf',
                mimeType: 'application/pdf',
                tamanhoBytes: 19,
                enviadoEm: new Date(),
                enviadoPor: {
                    id: userId,
                    nome: 'Guilherme',
                },
            }

            mockPrisma.chamado.findUnique.mockResolvedValueOnce(
                mockChamado,
            )

            mockPrisma.anexo.create.mockResolvedValueOnce(
                mockAnexo,
            )

            const resultado = await AnexosService.createAnexo(
                mockPrisma as any,
                mockReq,
                chamadoId,
                userId,
            )

            expect(resultado).toEqual(mockAnexo)

            expect(
                mockPrisma.chamado.findUnique,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: chamadoId },
                }),
            )

            expect(mockPrisma.anexo.create).toHaveBeenCalled()
        })

        it('deve lançar erro quando nenhum arquivo for enviado', async () => {
            const mockReq = {
                file: vi.fn().mockResolvedValue(null),
            } as any

            await expect(
                AnexosService.createAnexo(
                    mockPrisma as any,
                    mockReq,
                    'chamado-001',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                message: 'Nenhum arquivo enviado.',
                statusCode: 400,
            })

            expect(
                mockPrisma.chamado.findUnique,
            ).not.toHaveBeenCalled()
        })

        it('deve lançar erro quando o tipo do arquivo não for permitido', async () => {
            const mockReq = {
                file: vi.fn().mockResolvedValue({
                    filename: 'arquivo.exe',
                    mimetype: 'application/x-msdownload',
                    toBuffer: vi.fn(),
                }),
            } as any

            await expect(
                AnexosService.createAnexo(
                    mockPrisma as any,
                    mockReq,
                    'chamado-001',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                statusCode: 415,
            })

            expect(mockReq.file).toHaveBeenCalled()

            expect(
                mockPrisma.chamado.findUnique,
            ).not.toHaveBeenCalled()
        })

        it('deve lançar erro quando o chamado não existir', async () => {
            const mockReq = {
                file: vi.fn().mockResolvedValue({
                    filename: 'documento.pdf',
                    mimetype: 'application/pdf',
                    toBuffer: vi.fn().mockResolvedValue(
                        Buffer.from('conteudo'),
                    ),
                }),
            } as any

            mockPrisma.chamado.findUnique.mockResolvedValueOnce(null)

            await expect(
                AnexosService.createAnexo(
                    mockPrisma as any,
                    mockReq,
                    'chamado-inexistente',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                message: 'Chamado não encontrado',
                statusCode: 404,
            })

            expect(
                mockPrisma.anexo.create,
            ).not.toHaveBeenCalled()
        })

        it('deve lançar erro quando o arquivo ultrapassar 10 MB', async () => {
            const mockReq = {
                file: vi.fn().mockResolvedValue({
                    filename: 'arquivo.pdf',
                    mimetype: 'application/pdf',
                    toBuffer: vi.fn().mockResolvedValue(
                        Buffer.alloc(10 * 1024 * 1024 + 1),
                    ),
                }),
            } as any

            mockPrisma.chamado.findUnique.mockResolvedValueOnce({
                id: 'chamado-001',
                protocolo: 'CH-001',
                criadoPorId: 'user-002',
                responsavelId: 'user-003',
                organizacaoId: 'org-001',
            })

            await expect(
                AnexosService.createAnexo(
                    mockPrisma as any,
                    mockReq,
                    'chamado-001',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                statusCode: 413,
            })

            expect(
                mockPrisma.anexo.create,
            ).not.toHaveBeenCalled()
        })

        it('deve tratar erro ao criar o anexo', async () => {
            const mockReq = {
                file: vi.fn().mockResolvedValue({
                    filename: 'documento.pdf',
                    mimetype: 'application/pdf',
                    toBuffer: vi.fn().mockResolvedValue(
                        Buffer.from('conteudo'),
                    ),
                }),
            } as any

            mockPrisma.chamado.findUnique.mockResolvedValueOnce({
                id: 'chamado-001',
                protocolo: 'CH-001',
                criadoPorId: 'user-002',
                responsavelId: 'user-003',
                organizacaoId: 'org-001',
            })

            const erro = new Error('Erro ao salvar anexo')

            mockPrisma.anexo.create.mockRejectedValueOnce(erro)

            await expect(
                AnexosService.createAnexo(
                    mockPrisma as any,
                    mockReq,
                    'chamado-001',
                    'user-001',
                ),
            ).rejects.toThrow('Erro ao salvar anexo')
        })
    })

    describe('getAnexoForDownload()', () => {

        it('deve retornar os dados do arquivo com sucesso', async () => {
            const anexoId = 'anexo-001'
            const userId = 'user-001'

            const mockAnexo = {
                id: anexoId,
                caminhoArquivo: 'arquivo.pdf',
                nomeArquivo: 'documento.pdf',
                mimeType: 'application/pdf',
                enviadoPorId: userId,
                chamado: {
                    criadoPorId: 'user-002',
                    responsavelId: 'user-003',
                    setorId: null,
                },
            }

            mockPrisma.anexo.findUnique.mockResolvedValueOnce(
                mockAnexo,
            )

            const resultado =
                await AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    anexoId,
                    userId,
                )

            expect(resultado).toEqual(
                expect.objectContaining({
                    fileName: 'documento.pdf',
                    mimeType: 'application/pdf',
                }),
            )

            expect(
                mockPrisma.anexo.findUnique,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: anexoId },
                }),
            )
        })

        it('deve lançar erro quando o anexo não existir', async () => {
            mockPrisma.anexo.findUnique.mockResolvedValueOnce(null)

            await expect(
                AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    'anexo-inexistente',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                statusCode: 404,
            })

            expect(
                mockPrisma.usuarioSetor.findFirst,
            ).not.toHaveBeenCalled()
        })

        it('deve lançar erro quando o usuário não tiver permissão', async () => {
            mockPrisma.anexo.findUnique.mockResolvedValueOnce({
                id: 'anexo-001',
                caminhoArquivo: 'arquivo.pdf',
                nomeArquivo: 'documento.pdf',
                mimeType: 'application/pdf',
                enviadoPorId: 'user-002',
                chamado: {
                    criadoPorId: 'user-003',
                    responsavelId: 'user-004',
                    setorId: null,
                },
            })

            await expect(
                AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    'anexo-001',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                statusCode: 403,
            })

            expect(
                mockPrisma.usuarioSetor.findFirst,
            ).not.toHaveBeenCalled()
        })

        it('deve permitir acesso para administrador ou backoffice', async () => {
            const mockAnexo = {
                id: 'anexo-001',
                caminhoArquivo: 'arquivo.pdf',
                nomeArquivo: 'documento.pdf',
                mimeType: 'application/pdf',
                enviadoPorId: 'user-002',
                chamado: {
                    criadoPorId: 'user-003',
                    responsavelId: 'user-004',
                    setorId: null,
                },
            }

            mockPrisma.anexo.findUnique.mockResolvedValueOnce(
                mockAnexo,
            )

            const resultado =
                await AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    'anexo-001',
                    'admin-001',
                    'ADMINISTRADOR',
                )

            expect(resultado).toEqual(
                expect.objectContaining({
                    fileName: 'documento.pdf',
                    mimeType: 'application/pdf',
                }),
            )

            expect(
                mockPrisma.usuarioSetor.findFirst,
            ).not.toHaveBeenCalled()
        })

        it('deve lançar erro quando o arquivo físico não existir', async () => {
            mockPrisma.anexo.findUnique.mockResolvedValueOnce({
                id: 'anexo-001',
                caminhoArquivo: 'arquivo-inexistente.pdf',
                nomeArquivo: 'documento.pdf',
                mimeType: 'application/pdf',
                enviadoPorId: 'user-001',
                chamado: {
                    criadoPorId: 'user-001',
                    responsavelId: 'user-002',
                    setorId: null,
                },
            })

            const fs = await import('fs/promises')

            vi.mocked(fs.default.access).mockRejectedValueOnce(
                new Error('Arquivo não encontrado'),
            )

            await expect(
                AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    'anexo-001',
                    'user-001',
                ),
            ).rejects.toMatchObject({
                statusCode: 404,
            })
        })

        it('deve tratar erro inesperado ao buscar o anexo', async () => {
            const erro = new Error(
                'Erro inesperado no banco',
            )

            mockPrisma.anexo.findUnique.mockRejectedValueOnce(
                erro,
            )

            await expect(
                AnexosService.getAnexoForDownload(
                    mockPrisma as any,
                    'anexo-001',
                    'user-001',
                ),
            ).rejects.toThrow(
                'Erro inesperado no banco',
            )

            expect(
                mockPrisma.anexo.findUnique,
            ).toHaveBeenCalled()
        })
    })
})