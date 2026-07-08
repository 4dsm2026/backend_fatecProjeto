import { z } from "zod";
import { zStringTrim, zEmail } from "../../utils/zod-helpers";

export const ComunicacaoUpsertSchema = z.object({
  params: z.object({ chave: zStringTrim.min(1).max(64) }),
  body: z.object({
    nome: zStringTrim.min(1).max(160),
    descricao: zStringTrim.max(500).optional().nullable(),
    habilitado: z.boolean().optional().default(true),
    assunto: zStringTrim.min(1).max(500),
    corpo: zStringTrim.min(1),
    variaveis: z.array(z.string()).optional(),
  }),
});

export const ComunicacaoTesteSchema = z.object({
  body: z.object({
    to: zEmail,
    assunto: zStringTrim.min(1).max(500),
    corpo: zStringTrim.min(1),
  }),
});
