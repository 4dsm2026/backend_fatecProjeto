import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))
vi.mock('../../../src/config/mail', () => ({ getMailDriver: () => ({ send: mockSend }) }))

import {
  montarAvisoSenhaAlterada,
  enviarAvisoSenhaAlterada,
} from '../../../src/core/auth/senha-alterada.service'

const base = { nome: 'João', emailPessoal: 'joao@example.com', motivo: 'troca' as const }

beforeEach(() => {
  mockSend.mockReset().mockResolvedValue(undefined)
  vi.stubEnv('APP_WEB_URL', 'https://app.exemplo.com/')
})
afterEach(() => vi.unstubAllEnvs())

describe('montarAvisoSenhaAlterada', () => {
  it('sem nenhum e-mail cadastrado: não há destinatário (null)', () => {
    expect(montarAvisoSenhaAlterada({ ...base, emailPessoal: null, emailEducacional: null })).toBeNull()
  })

  it('envia para o e-mail pessoal; se faltar, usa o educacional', () => {
    expect(montarAvisoSenhaAlterada({ ...base, emailEducacional: 'a@fatec.sp.gov.br' })?.to).toBe('joao@example.com')
    expect(
      montarAvisoSenhaAlterada({ ...base, emailPessoal: null, emailEducacional: 'a@fatec.sp.gov.br' })?.to,
    ).toBe('a@fatec.sp.gov.br')
  })

  it('assunto fixo e texto distinto para troca e para reset', () => {
    const troca = montarAvisoSenhaAlterada({ ...base, motivo: 'troca' })!
    const reset = montarAvisoSenhaAlterada({ ...base, motivo: 'reset' })!
    expect(troca.subject).toBe('Sua senha foi alterada — Workflow Fatec')
    expect(troca.html).toContain('troca de senha feita dentro da sua conta')
    expect(reset.html).toContain('redefinição de senha feita por um link')
  })

  it('mostra a data em horário de Brasília', () => {
    const { html } = montarAvisoSenhaAlterada({ ...base, quando: new Date('2026-10-07T15:30:00Z') })!
    expect(html).toContain('07/10/2026')
    expect(html).toContain('12:30:00')
    expect(html).toContain('horário de Brasília')
  })

  it('inclui IP e dispositivo quando informados e omite quando ausentes', () => {
    const com = montarAvisoSenhaAlterada({ ...base, ip: '203.0.113.9', userAgent: 'Mozilla/5.0' })!
    expect(com.html).toContain('203.0.113.9')
    expect(com.html).toContain('Mozilla/5.0')

    const sem = montarAvisoSenhaAlterada(base)!
    expect(sem.html).not.toContain('Endereço de rede')
    expect(sem.html).not.toContain('Dispositivo')
  })

  it('escapa nome e user-agent (texto controlado pelo usuário)', () => {
    const { html } = montarAvisoSenhaAlterada({
      ...base,
      nome: '<script>alert(1)</script>',
      userAgent: '"><img src=x onerror=alert(1)>',
    })!
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('limita o tamanho do user-agent', () => {
    const { html } = montarAvisoSenhaAlterada({ ...base, userAgent: 'A'.repeat(500) })!
    expect(html).toContain('A'.repeat(120))
    expect(html).not.toContain('A'.repeat(121))
  })

  it('link de redefinição usa APP_WEB_URL sem barra duplicada', () => {
    const { html } = montarAvisoSenhaAlterada(base)!
    expect(html).toContain('href="https://app.exemplo.com/esqueci-senha"')
  })

  it('sem APP_WEB_URL: não há link, mas o aviso continua válido', () => {
    vi.stubEnv('APP_WEB_URL', '')
    const aviso = montarAvisoSenhaAlterada(base)!
    expect(aviso.html).not.toContain('<a ')
    expect(aviso.html).toContain('Se NÃO foi você')
  })

  it('nunca carrega token nem senha', () => {
    const { html } = montarAvisoSenhaAlterada(base)!
    expect(html).not.toContain('token=')
    expect(html.toLowerCase()).not.toContain('nova senha:')
  })
})

describe('enviarAvisoSenhaAlterada', () => {
  it('envia uma vez pelo driver de e-mail', async () => {
    await enviarAvisoSenhaAlterada(base)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'joao@example.com' }))
  })

  it('sem e-mail cadastrado: não chama o driver', async () => {
    await enviarAvisoSenhaAlterada({ ...base, emailPessoal: null })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('propaga a falha do driver (quem chama decide o que fazer)', async () => {
    mockSend.mockRejectedValue(new Error('SES indisponível'))
    await expect(enviarAvisoSenhaAlterada(base)).rejects.toThrow('SES indisponível')
  })
})
