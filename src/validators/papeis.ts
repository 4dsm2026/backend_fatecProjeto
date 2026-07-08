import { z } from "zod";

export const PapelCreateSchema = z.object({
  body: z.object({
    nome: z.string().min(2),
    descricao: z.string().min(1).optional().nullable(),
  }),
});

export const PapelUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: PapelCreateSchema.shape.body.partial(),
});

export const PapelIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
