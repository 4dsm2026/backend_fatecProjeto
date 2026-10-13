import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../src/utils/escape-html'

describe('escapeHtml', () => {
  it('escapa & < > " \'', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  it('não escapa duas vezes o que já é entidade de saída (escapa o & literal uma vez)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('devolve texto comum intacto', () => {
    expect(escapeHtml('João da Silva — 123')).toBe('João da Silva — 123')
  })
})
