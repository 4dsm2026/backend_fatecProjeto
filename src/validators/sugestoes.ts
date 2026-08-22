import { z } from 'zod'

/**
 * TODO: confirmar o limite real de caracteres da coluna `conteudo` no banco.
 * Usando 1000 como valor provisório (informado pelo responsável do projeto
 * como um meio-termo entre os limites comuns de 500 e 1000). Ajustar aqui e
 * na migration caso o padrão definitivo do projeto seja outro.
 */
export const SUGESTAO_CONTEUDO_MAX = 1000

const SugestaoBodySchema = z.object({
  conteudo: z
    .string()
    .trim()
    .min(3, 'A sugestão deve ter pelo menos 3 caracteres')
    .max(SUGESTAO_CONTEUDO_MAX, `A sugestão deve ter no máximo ${SUGESTAO_CONTEUDO_MAX} caracteres`),
})

export const SugestaoCreateSchema = z.object({
  body: SugestaoBodySchema,
})

export const SugestaoListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
})

export const ParamsWithIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
})
