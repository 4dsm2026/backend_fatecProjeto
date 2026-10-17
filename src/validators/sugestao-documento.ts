import { z } from 'zod'

type Atributo = string | number | boolean | null | number[]
type Marca = { type: string; attrs?: Record<string, Atributo> }
type NoDocumento = {
  type: string
  text?: string
  attrs?: Record<string, Atributo>
  marks?: Marca[]
  content?: NoDocumento[]
}
export type SugestaoDocumento = { type: 'doc'; content: NoDocumento[] }

const cor = z.string().max(50).regex(/^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i)
const alinhamento = z.enum(['left', 'center', 'right', 'justify']).nullable().optional()
const link = z.string().max(2048).refine((valor) => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(valor).protocol)
  } catch {
    return false
  }
}, 'Link inválido: use HTTP, HTTPS ou e-mail')
const MarcaSchema = z.union([
  z.object({ type: z.enum(['bold', 'italic', 'underline', 'strike']) }).strict(),
  z.object({
    type: z.literal('textStyle'),
    attrs: z.object({
      color: cor.nullable().optional(),
      backgroundColor: cor.nullable().optional(),
      fontFamily: z.enum(['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New']).nullable().optional(),
      fontSize: z.enum(['12px', '14px', '16px', '18px', '24px', '32px']).nullable().optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: link,
      target: z.enum(['_blank', '_self']).nullable().optional(),
      rel: z.string().max(100).nullable().optional(),
      class: z.string().max(100).nullable().optional(),
    }).strict(),
  }).strict(),
])

const InlineSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string().min(1).max(1000), marks: z.array(MarcaSchema).max(6).optional() }).strict(),
  z.object({ type: z.literal('hardBreak') }).strict(),
])
const ParagrafoSchema = z.object({
  type: z.literal('paragraph'),
  attrs: z.object({ textAlign: alinhamento }).strict().optional(),
  content: z.array(InlineSchema).max(1000).optional(),
}).strict()
const ImagemSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    src: z.string().max(2_796_240).regex(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/),
    alt: z.string().max(200).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
  }).strict(),
}).strict()

// A profundidade é limitada antes de iniciar a validação recursiva.
function estruturaLimitada(valor: unknown): boolean {
  const pendentes = [{ valor, nivel: 0 }]
  let total = 0
  while (pendentes.length > 0) {
    const item = pendentes.pop()
    if (!item) break
    if (++total > 2000 || item.nivel > 12) return false
    if (typeof item.valor !== 'object' || item.valor === null) return false
    const conteudo = Reflect.get(item.valor, 'content')
    if (conteudo !== undefined) {
      if (!Array.isArray(conteudo) || conteudo.length > 1000) return false
      for (const filho of conteudo) pendentes.push({ valor: filho, nivel: item.nivel + 1 })
    }
  }
  return true
}

const BlocoSchema: z.ZodType<NoDocumento> = z.lazy(() => z.union([
  ParagrafoSchema,
  ImagemSchema,
  z.object({ type: z.literal('horizontalRule') }).strict(),
  z.object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.number().int().min(1).max(3), textAlign: alinhamento }).strict(),
    content: z.array(InlineSchema).max(1000).optional(),
  }).strict(),
  z.object({ type: z.literal('blockquote'), content: z.array(BlocoSchema).min(1).max(100) }).strict(),
  z.object({ type: z.literal('bulletList'), content: z.array(ItemSchema).min(1).max(100) }).strict(),
  z.object({
    type: z.literal('orderedList'),
    attrs: z.object({ start: z.number().int().min(1).max(10000).optional(), type: z.string().max(10).nullable().optional() }).strict().optional(),
    content: z.array(ItemSchema).min(1).max(100),
  }).strict(),
  z.object({ type: z.literal('table'), content: z.array(LinhaSchema).min(1).max(20) }).strict(),
]))
const ItemSchema: z.ZodType<NoDocumento> = z.lazy(() => z.object({
  type: z.literal('listItem'),
  content: z.array(BlocoSchema).min(1).max(100).refine((nos) => nos[0]?.type === 'paragraph'),
}).strict())
const CelulaSchema: z.ZodType<NoDocumento> = z.lazy(() => z.object({
  type: z.enum(['tableCell', 'tableHeader']),
  attrs: z.object({
    colspan: z.number().int().min(1).max(10).optional(),
    rowspan: z.number().int().min(1).max(20).optional(),
    colwidth: z.array(z.number().int().min(1).max(2000)).max(10).nullable().optional(),
  }).strict().optional(),
  content: z.array(BlocoSchema).min(1).max(100),
}).strict())
const LinhaSchema: z.ZodType<NoDocumento> = z.lazy(() => z.object({
  type: z.literal('tableRow'), content: z.array(CelulaSchema).min(1).max(10),
}).strict())

export function extrairTextoDocumento(documento: SugestaoDocumento): string {
  const textos: string[] = []
  function visitar(no: NoDocumento) {
    if (no.type === 'paragraph' || no.type === 'heading') {
      textos.push((no.content ?? []).map((parte) => parte.type === 'hardBreak' ? '\n' : parte.text ?? '').join(''))
      return
    }
    no.content?.forEach(visitar)
  }
  documento.content.forEach(visitar)
  return textos.join('\n\n')
}

export const SugestaoDocumentoSchema = z.unknown().superRefine((valor, contexto) => {
  if (!estruturaLimitada(valor)) contexto.addIssue({ code: z.ZodIssueCode.custom, message: 'Documento muito complexo ou inválido', fatal: true })
}).pipe(z.object({ type: z.literal('doc'), content: z.array(BlocoSchema).min(1).max(100) }).strict()).superRefine((documento, contexto) => {
  if (extrairTextoDocumento(documento).trim().length > 1000) {
    contexto.addIssue({ code: z.ZodIssueCode.custom, message: 'A sugestão deve ter no máximo 1000 caracteres de texto' })
  }
  let imagens = 0
  function contar(no: NoDocumento) {
    if (no.type === 'image') imagens++
    no.content?.forEach(contar)
  }
  documento.content.forEach(contar)
  if (imagens > 3) contexto.addIssue({ code: z.ZodIssueCode.custom, message: 'A sugestão pode conter no máximo 3 imagens' })
})
