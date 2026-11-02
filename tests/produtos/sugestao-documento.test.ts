import { describe, expect, it } from 'vitest'
import { extrairTextoDocumento, SugestaoDocumentoSchema } from '../../src/validators/sugestao-documento'

const paragrafo = { type: 'paragraph', content: [{ type: 'text', text: 'Texto de teste' }] }
const documento = (content: unknown[]) => ({ type: 'doc', content })

describe('Documento rico de sugestão', () => {
  it('aceita títulos, listas, tabela, cores e links', () => {
    const resultado = SugestaoDocumentoSchema.parse(documento([
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Título' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragrafo] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragrafo] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Site', marks: [
        { type: 'textStyle', attrs: { color: '#ff0000', backgroundColor: 'rgb(255, 255, 0)', fontFamily: 'Arial', fontSize: '18px' } },
        { type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer', class: null } },
      ] }] },
    ]))
    expect(extrairTextoDocumento(resultado)).toBe('Título\n\nTexto de teste\n\nTexto de teste\n\nSite')
  })

  it('mantém documentos antigos compatíveis', () => {
    expect(SugestaoDocumentoSchema.safeParse(documento([paragrafo])).success).toBe(true)
  })

  it('rejeita links executáveis e estilos fora da lista permitida', () => {
    for (const marca of [
      { type: 'link', attrs: { href: 'javascript:alert(1)' } },
      { type: 'textStyle', attrs: { color: 'url(https://example.com)' } },
    ]) {
      expect(SugestaoDocumentoSchema.safeParse(documento([
        { type: 'paragraph', content: [{ type: 'text', text: 'Teste', marks: [marca] }] },
      ])).success).toBe(false)
    }
  })

  it('conta imagens dentro de blocos', () => {
    const imagem = { type: 'image', attrs: { src: 'data:image/png;base64,YQ==' } }
    expect(SugestaoDocumentoSchema.safeParse(documento([
      { type: 'blockquote', content: [paragrafo, imagem, imagem, imagem, imagem] },
    ])).success).toBe(false)
  })

  it('limita profundidade e texto dentro de tabelas', () => {
    let bloco: unknown = paragrafo
    for (let indice = 0; indice < 15; indice++) bloco = { type: 'blockquote', content: [bloco] }
    expect(SugestaoDocumentoSchema.safeParse(documento([bloco])).success).toBe(false)
    expect(SugestaoDocumentoSchema.safeParse(documento([
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(600) }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b'.repeat(600) }] },
      ] }] }] },
    ])).success).toBe(false)
  })
})
