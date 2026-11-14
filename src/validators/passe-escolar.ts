import { z } from "zod";
import { PaginationQuerySchema } from "../hateoas";
import { STATUS_PASSE_VALUES } from "../core/passe-escolar/passe-escolar.rules";
import { zBooleanish } from "../utils/zod-helpers";

export const PASSE_OBSERVACAO_MAX = 500;
export const PASSE_COMENTARIO_MAX = 1000;
const ANO_MIN = 2024;
const ANO_MAX = 2100;

const somenteDigitos = (s: string) => s.replace(/\D/g, "");

/** Valida os dígitos verificadores do CPF (rejeita sequências repetidas). */
export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (fim: number) => {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (fim + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const zCpf = z
  .string()
  .trim()
  .transform(somenteDigitos)
  .refine((d) => d.length === 11, "CPF deve ter 11 dígitos")
  .refine(cpfValido, "CPF inválido");

const zCep = z
  .string()
  .trim()
  .transform(somenteDigitos)
  .refine((d) => d.length === 8, "CEP deve ter 8 dígitos");

const zRg = z
  .string()
  .trim()
  .min(5, "RG deve ter pelo menos 5 caracteres")
  .max(20, "RG deve ter no máximo 20 caracteres")
  .regex(/^[0-9A-Za-z.\-/ ]+$/, "RG com caracteres inválidos");

export const StatusPasseSchema = z.enum(STATUS_PASSE_VALUES as [string, ...string[]]);
export const ModalidadeSchema = z.enum(["PASSE_LIVRE", "MEIA_TARIFA"]);
export const TipoPedidoSchema = z.enum(["NOVO", "REVALIDACAO"]);

const DadosSchema = z.object({
  nomeCompleto: z.string().trim().min(3, "Informe o nome completo").max(120),
  rg: zRg,
  cpf: zCpf,
  cep: zCep,
  municipioResidencia: z.string().trim().min(2, "Informe o município").max(80),
  curso: z.string().trim().min(2, "Informe o curso").max(120),
  periodo: z.string().trim().min(2, "Informe o período").max(40),
  mesConclusao: z.coerce.number().int().min(1).max(12),
  anoConclusao: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX),
  declaraBaixaRenda: zBooleanish.default(false),
  observacaoAluno: z.string().trim().max(PASSE_OBSERVACAO_MAX).optional().nullable(),
});

const baixaRendaNoPasseLivre = {
  message: "O Passe Livre exige a declaração de renda familiar per capita até 1,5 salário mínimo",
  path: ["declaraBaixaRenda"],
};

export const PasseEscolarCreateSchema = z.object({
  body: DadosSchema.extend({
    anoReferencia: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX).optional(),
    tipo: TipoPedidoSchema.default("NOVO"),
    modalidade: ModalidadeSchema,
  }).refine((b) => b.modalidade !== "PASSE_LIVRE" || b.declaraBaixaRenda, baixaRendaNoPasseLivre),
});

export const PasseEscolarUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: DadosSchema.partial()
    .extend({
      tipo: TipoPedidoSchema.optional(),
      modalidade: ModalidadeSchema.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo" }),
});

export const PasseEscolarTransitionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: StatusPasseSchema,
    comentario: z.string().trim().min(1).max(PASSE_COMENTARIO_MAX).optional(),
    protocoloEmtu: z.string().trim().min(1).max(40).optional(),
  }),
});

/** `status` aceita um valor ou vários (`?status=A&status=B` ou `?status=A,B`). */
const zStatusList = z
  .union([StatusPasseSchema, z.array(StatusPasseSchema), z.string()])
  .transform((v) => {
    const lista = Array.isArray(v) ? v : String(v).split(",");
    return lista.map((s) => s.trim()).filter(Boolean);
  })
  .pipe(z.array(StatusPasseSchema).min(1))
  .optional();

export const PasseEscolarListSchema = z.object({
  query: PaginationQuerySchema.extend({
    status: zStatusList,
    ano: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX).optional(),
    ativos: zBooleanish.optional(),
    search: z.string().trim().min(1).max(80).optional(),
  }),
});

export const PasseEscolarExportSchema = z.object({
  query: z.object({
    ano: z.coerce.number().int().min(ANO_MIN).max(ANO_MAX).optional(),
    status: zStatusList,
  }),
});

export const ParamsWithIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
