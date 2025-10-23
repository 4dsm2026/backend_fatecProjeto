import { z } from "zod";

const pag = {
  page: z.coerce.number().int().min(1).default(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).default(20).optional(),
};

export const SetorCreateSchema = z.object({
  body: z.object({
    nome: z.string().min(2),
    descricao: z.string().min(1).optional().nullable(),
    organizacaoId: z.string().cuid().optional().nullable(),
  }),
});

export const SetorUpdateSchema = z.object({
  params: z.object({ id: z.string().cuid() }),
  body: SetorCreateSchema.shape.body.partial(),
});

export const SetorListSchema = z.object({
  query: z.object({
    ...pag,
    search: z.string().min(1).optional(),
    organizacaoId: z.string().cuid().optional(),
  }),
});

export const SetorIdSchema = z.object({
  params: z.object({ id: z.string().cuid() }),
});
