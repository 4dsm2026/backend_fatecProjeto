import { vi, describe, it, expect, afterEach } from 'vitest'
vi.mock('../../../src/lib/prisma')
import { prismaMock } from '../../../src/lib/__mocks__/prisma'
import { createTicketMessage, listTicketMessages } from '../../../src/core/ticket-messages/messages.service'

describe('ticket-messages-test', () => {

    it('Cria uma nova mensagem vinculada a um chamado', async () => {
        prismaMock.mensagem.create.mockResolvedValue({
            id: 'msg-1',
            chamadoId: 'chamado-1',
            autorId: 'user-1',
            conteudo: 'Olá, tudo bem?',
            autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
        })

        prismaMock.chamado.findUnique.mockResolvedValue({
            criadoPorId: 'user-1',
            responsavelId: null,
            setorId: null,
            organizacaoId: 'org-1',
            protocolo: 'TCK-001'
        })

        const resultado = await createTicketMessage(prismaMock, 'chamado-1', 'user-1', 'Ola tudo bem')

        expect(prismaMock.mensagem.create).toHaveBeenCalledWith({
            data: {
                chamadoId: 'chamado-1',
                autorId: 'user-1',
                conteudo: 'Ola tudo bem'
            },
            include: {
                autor: { select: { id: true, nome: true, emailPessoal: true } }
            }
        })

        expect(resultado).toEqual({
            id: 'msg-1',
            chamadoId: 'chamado-1',
            autorId: 'user-1',
            conteudo: 'Olá, tudo bem?',
            autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
        })
    })

    // Setup compartilhado pelos dois testes de notificação: só o
    // criadoPorId muda (autor da mensagem envolvido x não envolvido).
    function mockarCriacaoDeMensagem(criadoPorId: string) {
        ;(global as any).fastifyAppInstance = {
            notifyUsers: vi.fn()
        }

            ; (globalThis as any).sendToUsersWS = vi.fn()

        prismaMock.mensagem.create.mockResolvedValue({
            id: 'msg-1',
            chamadoId: 'chamado-1',
            autorId: 'user-1',
            conteudo: 'Preciso de ajuda',
            autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
        })

        prismaMock.chamado.findUnique.mockResolvedValue({
            criadoPorId,
            responsavelId: null,
            setorId: null,
            organizacaoId: 'org-1',
            protocolo: 'TCK-001'
        })
    }

    it('deve notificar os usuários envolvidos quando a mensagem é criada', async () => {
        mockarCriacaoDeMensagem('user-2')

        await createTicketMessage(prismaMock, 'chamado-1', 'user-1', 'Preciso de ajuda')

        expect((global as any).fastifyAppInstance.notifyUsers).toHaveBeenCalled()
    })

    it('Não deve notificar os usuários envolvidos quando a mensagem é criada', async () => {
        mockarCriacaoDeMensagem('user-1')

        await createTicketMessage(prismaMock, 'chamado-1', 'user-1', 'Preciso de ajuda')

        expect((global as any).fastifyAppInstance.notifyUsers).not.toHaveBeenCalled()
    })

    it('envia a mensagem em tempo real só para quem participa do chamado', async () => {
        ;(global as any).fastifyAppInstance = { notifyUsers: vi.fn() }
        const sendToUsersWS = vi.fn()
        ;(globalThis as any).sendToUsersWS = sendToUsersWS

        prismaMock.mensagem.create.mockResolvedValue({
            id: 'msg-9',
            chamadoId: 'chamado-9',
            autorId: 'staff-1',
            conteudo: 'Sua declaração está pronta',
            autor: { id: 'staff-1', nome: 'Ana', emailPessoal: 'ana@teste.com' }
        })
        prismaMock.chamado.findUnique.mockResolvedValue({
            criadoPorId: 'aluno-1',
            responsavelId: 'staff-1',
            setorId: 'setor-1',
            organizacaoId: 'org-1',
            protocolo: 'TCK-009'
        })
        prismaMock.usuarioSetor.findMany.mockResolvedValue([{ usuarioId: 'staff-2' }])

        await createTicketMessage(prismaMock, 'chamado-9', 'staff-1', 'Sua declaração está pronta')

        expect(sendToUsersWS).toHaveBeenCalledTimes(1)
        const [destinatarios, evento] = sendToUsersWS.mock.calls[0]
        expect(new Set(destinatarios)).toEqual(new Set(['aluno-1', 'staff-2', 'staff-1']))
        expect(destinatarios).not.toContain('outro-aluno')
        expect(evento).toMatchObject({ type: 'nova_mensagem', chamadoId: 'chamado-9' })
        expect((globalThis as any).broadcastWS).toBeUndefined()
    })

    it.each([
        {
            label: 'quando query vem vazio, a função usa os valores padrão de paginação',
            query: {},
            esperado: { skip: 0, take: 100, page: 1, pageSize: 100 },
        },
        {
            label: 'quando query vem com page e pageSize customizados, a função usa esses valores',
            query: { page: 2, pageSize: 10 },
            esperado: { skip: 10, take: 10, page: 2, pageSize: 10 },
        },
    ])('$label', async ({ query, esperado }) => {
        prismaMock.mensagem.count.mockResolvedValue(3)

        prismaMock.mensagem.findMany.mockResolvedValue([
            {
                id: 'msg-1',
                chamadoId: 'chamado-1',
                autorId: 'user-1',
                conteudo: 'Oi',
                autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' }
            }
        ])

        const resultado = await listTicketMessages(prismaMock, 'chamado-1', query)

        expect(prismaMock.mensagem.findMany).toHaveBeenCalledWith({
            where: { chamadoId: 'chamado-1' },
            orderBy: { criadoEm: 'asc' },
            skip: esperado.skip,
            take: esperado.take,
            include: {
                autor: { select: { id: true, nome: true, emailPessoal: true } }
            }
        })

        expect(resultado).toEqual({
            total: 3,
            page: esperado.page,
            pageSize: esperado.pageSize,
            mensagens: [
                { id: 'msg-1', chamadoId: 'chamado-1', autorId: 'user-1', conteudo: 'Oi', autor: { id: 'user-1', nome: 'João', emailPessoal: 'joao@teste.com' } }
            ]
        })
    })
})


/*
        afterEach(() => {
            delete (global as any).fastifyAppInstance
            delete (globalThis as any).broadcastWS
        })
*/


// pnpm vitest tests/core/ticket-messages/messages.service.test.ts
