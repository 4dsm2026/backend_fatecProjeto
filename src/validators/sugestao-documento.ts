import { z } from 'zod'

const DATA_IMAGE_REGEX =
  /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/

const MarcaSchema = z
  .object({
    type: z.enum(['bold', 'italic']),
  })
  .strict()

const TextoSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(1000),
    marks: z.array(MarcaSchema).max(2).optional(),
  })
  .strict()

const QuebraLinhaSchema = z
  .object({
    type: z.literal('hardBreak'),
  })
  .strict()

const ParagrafoSchema = z
  .object({
    type: z.literal('paragraph'),
    content: z
      .array(z.union([TextoSchema, QuebraLinhaSchema]))
      .max(1000)
      .optional(),
  })
  .strict()

const ImagemSchema = z
  .object({
    type: z.literal('image'),
    attrs: z
      .object({
        src: z
          .string()
          .max(3_000_000, 'Imagem muito grande')
          .regex(DATA_IMAGE_REGEX, 'Formato de imagem inválido'),
        alt: z.string().max(200).nullable().optional(),
        title: z.string().max(200).nullable().optional(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
      })
      .strict(),
  })
  .strict()

const BlocoSchema = z.union([ParagrafoSchema, ImagemSchema])

const DocumentoBaseSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(BlocoSchema).min(1).max(100),
  })
  .strict()

type DocumentoBase = z.infer<typeof DocumentoBaseSchema>

export function extrairTextoDocumento(documento: DocumentoBase): string {
  return documento.content
    .filter((bloco) => bloco.type === 'paragraph')
    .map((paragrafo) =>
      (paragrafo.content ?? [])
        .map((parte) => (parte.type === 'text' ? parte.text : '\n'))
        .join(''),
    )
    .join('\n\n')
}

export const SugestaoDocumentoSchema = DocumentoBaseSchema.refine(
  (documento) => extrairTextoDocumento(documento).trim().length <= 1000,
  {
    message: 'A sugestão deve ter no máximo 1000 caracteres de texto',
  },
).refine(
  (documento) =>
    documento.content.filter((bloco) => bloco.type === 'image').length <= 3,
  {
    message: 'A sugestão pode conter no máximo 3 imagens',
  },
)

export type SugestaoDocumento = z.infer<typeof SugestaoDocumentoSchema>
