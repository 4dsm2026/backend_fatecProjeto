import { z } from "zod";
import { PaginationQuerySchema } from "../hateoas";
import { STATUS_PESQUISA_VALUES, TIPO_PERGUNTA_VALUES, semestreValido } from "../core/pesquisas/pesquisas.rules";

export const PESQUISA_MAX_PERGUNTAS = 60;
export const PESQUISA_TEXTO_MAX = 1000;

const zSemestre = z.string().trim().refine(semestreValido, 'Semestre no formato AAAA-1 ou AAAA-2 (ex.: "2026-2")');
const StatusSchema = z.enum(STATUS_PESQUISA_VALUES as [string, ...string[]]);

const PerguntaSchema = z
  .object({
    secao: z.string().trim().max(80).optional().nullable(),
    texto: z.string().trim().min(3, "Escreva a pergunta").max(300),
    tipo: z.enum(TIPO_PERGUNTA_VALUES as [string, ...string[]]),
    opcoes: z.array(z.string().trim().min(1).max(120)).max(12).optional().nullable(),
    obrigatoria: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.tipo !== "MULTIPLA") return;
    const opcoes = p.opcoes ?? [];
    if (opcoes.length < 2) {
      ctx.addIssue({ code: "custom", path: ["opcoes"], message: "Pergunta de múltipla escolha precisa de ao menos 2 opções" });
    } else if (new Set(opcoes).size !== opcoes.length) {
      ctx.addIssue({ code: "custom", path: ["opcoes"], message: "Há opções repetidas" });
    }
  });

const zCursos = z.array(z.string().trim().min(1).max(128)).max(100).optional().nullable();
const zFechaEm = z.coerce.date().optional().nullable();
const zPerguntas = z.array(PerguntaSchema).max(PESQUISA_MAX_PERGUNTAS);

export const PesquisaCreateSchema = z.object({
  body: z.object({
    titulo: z.string().trim().min(3, "Informe o título").max(160),
    descricao: z.string().trim().max(2000).optional().nullable(),
    semestre: zSemestre,
    cursos: zCursos,
    fechaEm: zFechaEm,
    perguntas: zPerguntas.optional(),
    modelo: z.boolean().default(true),
  }),
});

const IdParams = z.object({ id: z.string().min(1) });

export const PesquisaUpdateSchema = z.object({
  params: IdParams,
  body: z
    .object({
      titulo: z.string().trim().min(3).max(160).optional(),
      descricao: z.string().trim().max(2000).optional().nullable(),
      semestre: zSemestre.optional(),
      cursos: zCursos,
      fechaEm: zFechaEm,
      perguntas: zPerguntas.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo" }),
});

export const PesquisaStatusSchema = z.object({
  params: IdParams,
  body: z.object({ status: StatusSchema }),
});

export const PesquisaCopySchema = z.object({
  params: IdParams,
  body: z.object({
    semestre: zSemestre,
    titulo: z.string().trim().min(3).max(160).optional(),
  }),
});

export const PesquisaRespostaSchema = z.object({
  params: IdParams,
  body: z.object({
    respostas: z.record(
      z.string().min(1).max(64),
      z.union([z.number().int().min(0).max(5), z.string().max(PESQUISA_TEXTO_MAX), z.null()]),
    ),
  }),
});

export const PesquisaListSchema = z.object({
  query: PaginationQuerySchema.extend({
    semestre: zSemestre.optional(),
    status: StatusSchema.optional(),
  }),
});

export const PesquisaResultadosSchema = z.object({
  params: IdParams,
  query: z.object({ curso: z.string().trim().min(1).max(128).optional() }),
});

export const ParamsWithIdSchema = z.object({ params: IdParams });
