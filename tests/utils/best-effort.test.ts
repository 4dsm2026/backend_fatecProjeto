import { describe, it, expect, vi, afterEach } from 'vitest'
import { bestEffort } from '../../src/utils/best-effort'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bestEffort', () => {
  it('espera a tarefa terminar antes de resolver (sem escrita pendente)', async () => {
    let terminou = false
    const tarefa = new Promise<void>((resolve) => {
      setTimeout(() => {
        terminou = true
        resolve()
      }, 20)
    })

    await bestEffort('lenta', tarefa)

    expect(terminou).toBe(true)
  })

  it('engole a falha: não lança e registra no log com o rótulo', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = new Error('banco fora do ar')

    await expect(bestEffort('notificar-teste', Promise.reject(erro))).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('[notificar-teste]')
    expect(log.mock.calls[0][1]).toBe(erro)
  })

  it('não loga nada quando a tarefa dá certo', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await bestEffort('ok', Promise.resolve('qualquer coisa'))

    expect(log).not.toHaveBeenCalled()
  })

  it('aceita undefined (mock que não devolve promise)', async () => {
    await expect(bestEffort('sem-promise', undefined)).resolves.toBeUndefined()
  })
})
