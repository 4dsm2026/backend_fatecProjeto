import { z } from "zod";
import { PaginationQuerySchema } from "../../hateoas";

export interface AuditoriaRecord {
  id: string;
  feitoPorId: string | null;
}

export const AuditoriaListQuerySchema = PaginationQuerySchema.extend({
  userId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine(
  ({ from, to }) => !from || !to || from <= to,
  { message: "'from' deve ser anterior ou igual a 'to'", path: ["to"] },
);

export type AuditoriaListQuery = z.infer<typeof AuditoriaListQuerySchema>;

export interface RegistrarAuditoriaDTO {
  acao: string;
  alvo?: string;
  meta?: unknown;
  feitoPorId?: string | null;
}
