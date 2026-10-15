import { z } from "zod";
import { PaginationQuerySchema } from "../hateoas/pagination";

export const SetorCreateSchema = z.object({
  body: z.object({
    nome: z.string().min(2),
    descricao: z.string().min(1).optional().nullable(),
    organizacaoId: z.string().min(1).optional().nullable(),
  }),
});

export const SetorUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: SetorCreateSchema.shape.body.partial(),
});

export const SetorListSchema = z.object({
  query: PaginationQuerySchema.extend({
    search: z.string().min(1).optional(),
    organizacaoId: z.string().min(1).optional(),
  }),
});

export const SetorIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
