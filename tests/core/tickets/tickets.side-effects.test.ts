/**
 * Efeitos colaterais de updateTicket (notificação e auditoria).
 * Garante que a escrita termina ANTES da resposta (nada fica pendente para o próximo teste)
 * e que uma falha dela não derruba a atualização do chamado.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/lib/prisma')
vi.mock('../../../src/core/notifications/notify', () => ({ notifyMany: vi.fn() }))

import { updateTicket } from '../../../src/core/tickets/tickets.service'
import { notifyMany } from '../../../src/core/notifications/notify'

type Ctx = Parameters<typeof updateTicket>[0]

const notifyMock = vi.mocked(notifyMany)

const chamadoAntes = {
  id: 'c1',
  status: 'ABERTO',
  responsavelId: null,
  protocolo: 'TCK-TESTE1',
  criadoPorId: 'aluno-1',
  organizacaoId: null,
  setorId: null,
}

function makeCtx(auditoriaCreate: () => Promise<unknown> | undefined = () => Promise.resolve({})) {
  const ctx = {
    chamado: {
      findFirst: vi.fn().mockResolvedValue(chamadoAntes),
      update: vi.fn().mockResolvedValue({ ...chamadoAntes }),
      findUnique: vi.fn().mockResolvedValue(chamadoAntes),
    },
    historicoStatusChamado: { create: vi.fn().mockResolvedValue({}) },
    auditoria: { create: vi.fn(auditoriaCreate) },
    usuarioSetor: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return ctx as unknown as Ctx & typeof ctx
}

const depois = (ms: number, quando: () => void) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      quando()
      resolve()
    }, ms)
  })

let erroNoLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  notifyMock.mockReset()
  erroNoLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('updateTicket: auditoria de arquivar', () => {
  it('só resolve depois de gravar a auditoria', async () => {
    let gravou = false
    const ctx = makeCtx(() => depois(20, () => { gravou = true }))

    await updateTicket(ctx, 'c1', { arquivado: true }, { feitoPorId: 'admin-1' })

    expect(gravou).toBe(true)
    expect(ctx.auditoria.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: 'ARQUIVAR_CHAMADO', alvo: 'c1' }) }),
    )
  })

  it('se a auditoria falhar, o chamado é atualizado mesmo assim e o erro vai para o log', async () => {
    const ctx = makeCtx(() => Promise.reject(new Error('falha na auditoria')))

    const resultado = await updateTicket(ctx, 'c1', { arquivado: true }, { feitoPorId: 'admin-1' })

    expect(resultado).toBeDefined()
    expect(ctx.chamado.update).toHaveBeenCalled()
    expect(erroNoLog).toHaveBeenCalledWith(expect.stringContaining('[auditoria-arquivar-chamado]'), expect.any(Error))
  })

  it('desarquivar também audita', async () => {
    const ctx = makeCtx()

    await updateTicket(ctx, 'c1', { arquivado: false }, { feitoPorId: 'admin-1' })

    expect(ctx.auditoria.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: 'DESARQUIVAR_CHAMADO' }) }),
    )
  })
})

describe('updateTicket: notificações', () => {
  it('mudança de status só resolve depois de notificar', async () => {
    let notificou = false
    notifyMock.mockImplementation(() => depois(20, () => { notificou = true }))
    const ctx = makeCtx()

    await updateTicket(ctx, 'c1', { status: 'EM_ATENDIMENTO' }, { feitoPorId: 'func-1' })

    expect(notificou).toBe(true)
    expect(notifyMock).toHaveBeenCalledWith(
      ctx,
      expect.any(Array),
      expect.objectContaining({ tipo: 'STATUS_ALTERADO', chamadoId: 'c1' }),
    )
  })

  it('atribuição só resolve depois de notificar o responsável', async () => {
    let notificou = false
    notifyMock.mockImplementation(() => depois(20, () => { notificou = true }))
    const ctx = makeCtx()

    await updateTicket(ctx, 'c1', { responsavelId: 'func-9' }, { feitoPorId: 'admin-1' })

    expect(notificou).toBe(true)
    expect(notifyMock).toHaveBeenCalledWith(
      ctx,
      ['func-9'],
      expect.objectContaining({ tipo: 'CHAMADO_ATRIBUIDO' }),
    )
  })

  it('se a notificação falhar, o chamado é atualizado e o erro vai para o log', async () => {
    notifyMock.mockRejectedValue(new Error('falha ao notificar'))
    const ctx = makeCtx()

    const resultado = await updateTicket(ctx, 'c1', { status: 'EM_ATENDIMENTO' }, { feitoPorId: 'func-1' })

    expect(resultado).toBeDefined()
    expect(erroNoLog).toHaveBeenCalledWith(expect.stringContaining('[notificar-status-alterado]'), expect.any(Error))
  })
})
