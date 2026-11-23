import { expect, inject, vi } from 'vitest'

export type CapturedEmail = { id: string; to: string[]; subject: string; html: string }

export async function waitForEmail(to: string, subject: string): Promise<CapturedEmail> {
  let found: CapturedEmail | undefined
  await vi.waitFor(async () => {
    const response = await fetch(`${inject('integrationMailboxUrl')}/__mailbox?to=${encodeURIComponent(to)}`)
    if (!response.ok) throw new Error(`Falha na mailbox: ${response.status}`)
    const messages = await response.json() as CapturedEmail[]
    found = messages.find(message => message.subject.includes(subject))
    expect(found, `E-mail '${subject}' para ${to}`).toBeDefined()
  }, { timeout: 15_000, interval: 100 })
  return found!
}

export function extractToken(html: string): string {
  const match = /[?&]token=([a-f0-9]{64})/i.exec(html)
  if (!match) throw new Error('Token não encontrado no e-mail')
  return match[1]
}
