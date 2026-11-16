import { z } from "zod";
import { emailValido } from "../core/roteamento/roteamento.rules";

const zId = z.string().trim().min(1).max(64);
const zChave = z.string().trim().min(1).max(64).nullable().optional().or(z.literal("").transform(() => null));

const RegraBody = z.object({
  nome: z.string().trim().min(2, "Dê um nome à regra").max(120),
  ordem: z.number().int().min(0).max(9999).optional(),
  ativo: z.boolean().optional(),
  categoriaChave: zChave,
  servicoChave: zChave,
  setorId: zId,
  setorCopiaId: zId.nullable().optional().or(z.literal("").transform(() => null)),
});

const temChave = (b: { categoriaChave?: string | null; servicoChave?: string | null }) => !!(b.categoriaChave || b.servicoChave);
const copiaDiferente = (b: { setorId?: string; setorCopiaId?: string | null }) => !b.setorCopiaId || b.setorCopiaId !== b.setorId;

export const RegraCriarSchema = z.object({
  body: RegraBody.refine(temChave, { message: "Escolha a categoria ou o serviço", path: ["categoriaChave"] }).refine(copiaDiferente, {
    message: "O setor em cópia deve ser outro",
    path: ["setorCopiaId"],
  }),
});

export const RegraAtualizarSchema = z.object({
  params: z.object({ id: zId }),
  body: RegraBody.partial()
    .refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo" })
    .refine(copiaDiferente, { message: "O setor em cópia deve ser outro", path: ["setorCopiaId"] }),
});

export const RegraIdSchema = z.object({ params: z.object({ id: zId }) });

const ContatoBody = z
  .object({
    nivel: z.enum(["PRIMEIRO", "SEGUNDO", "COPIA"]),
    usuarioId: zId.nullable().optional(),
    email: z.string().trim().max(254).nullable().optional(),
    nome: z.string().trim().max(120).nullable().optional(),
  })
  .refine((c) => !!c.usuarioId !== !!c.email, { message: "Informe um usuário ou um e-mail", path: ["email"] })
  .refine((c) => !c.email || emailValido(c.email), { message: "E-mail inválido", path: ["email"] });

export const HierarquiaSchema = z.object({
  params: z.object({ id: zId }),
  body: z.object({
    prazoEscalonamentoHoras: z.number().int().min(1, "Mínimo de 1 hora").max(720).nullable(),
    contatos: z.array(ContatoBody).max(50, "No máximo 50 contatos por setor"),
  }),
});

export const SetorIdSchema = z.object({ params: z.object({ id: zId }) });

export const SimularSchema = z.object({
  body: z.object({
    servico: z.string().trim().max(64).nullable().optional(),
    categoria: z.string().trim().max(64).nullable().optional(),
    setorProvavel: z.string().trim().max(120).nullable().optional(),
  }),
});
