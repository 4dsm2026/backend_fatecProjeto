import { describe, it, expect } from 'vitest'
import { rotuloChamado } from '../../src/utils/protocolo'

describe('rotuloChamado (#102)', () => {
  it('usa o protocolo quando existe', () => {
    expect(rotuloChamado('TCK-ABC123')).toBe('TCK-ABC123')
  })
  it.each([null, undefined, '', '  '])('sem protocolo (%j) nunca cai no id interno', (p) => {
    expect(rotuloChamado(p)).toBe('sem protocolo')
  })
})
