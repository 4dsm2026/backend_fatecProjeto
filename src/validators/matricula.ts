import { z } from "zod";
import { PaginationQuerySchema } from "../hateoas";
import { MOTIVOS, STATUS_VALUES, TIPO_VALUES, semestreValido } from "../core/matricula/matricula.rules";
import { zBooleanish } from "../utils/zod-helpers";

export const JUSTIFICATIVA_MAX = 2000;
export const COMENTARIO_MAX = 1000;

const TipoSchema = z.enum(TIPO_VALUES as [string, ...string[]]);
const StatusSchema = z.enum(STATUS_VALUES as [string, ...string[]]);
const MotivoSchema = z.enum(MOTIVOS);
const zSemestre = z.string().trim().refine(semestreValido, 'Semestre no formato AAAA-1 ou AAAA-2 (ex.: "2026-2")');
const IdParams = z.object({ id: z.string().min(1) });

export const SolicitacaoCreateSchema = z.object({
  body: z
    .object({
      tipo: TipoSchema,
      semestre: zSemestre.optional(),
      motivo: MotivoSchema,
      justificativa: z.string().trim().max(JUSTIFICATIVA_MAX).optional().nullable(),
      /** Cancelamento é definitivo: o aluno precisa confirmar que entendeu. */
      cienteDefinitivo: z.boolean().optional(),
    })
    .refine((b) => b.tipo !== "CANCELAMENTO" || b.cienteDefinitivo === true, {
      message: "Confirme que entende que o cancelamento é definitivo",
      path: ["cienteDefinitivo"],
    })
    .refine((b) => b.motivo !== "OUTRO" || (b.justificativa ?? "").length >= 5, {
      message: 'Explique o motivo quando escolher "Outro"',
      path: ["justificativa"],
    }),
});

export const SolicitacaoRespostaSchema = z.object({
  params: IdParams,
  body: z.object({
    justificativa: z.string().trim().min(3, "Escreva a resposta à Secretaria").max(JUSTIFICATIVA_MAX),
  }),
});

export const SolicitacaoStatusSchema = z.object({
  params: IdParams,
  body: z.object({
    status: StatusSchema,
    comentario: z.string().trim().min(1).max(COMENTARIO_MAX).optional(),
  }),
});

const zLista = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).min(1))
    .optional();

export const SolicitacaoListSchema = z.object({
  query: PaginationQuerySchema.extend({
    status: zLista(StatusSchema),
    tipo: TipoSchema.optional(),
    semestre: zSemestre.optional(),
    curso: z.string().trim().min(1).max(128).optional(),
    usuarioId: z.string().trim().min(1).max(64).optional(),
    abertos: zBooleanish.optional(),
    search: z.string().trim().min(1).max(80).optional(),
  }),
});

export const SolicitacaoResumoSchema = z.object({
  query: z.object({ semestre: zSemestre.optional() }),
});

export const ParamsWithIdSchema = z.object({ params: IdParams });
