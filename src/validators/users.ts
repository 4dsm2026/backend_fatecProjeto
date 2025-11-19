import { z } from 'zod'

export const PapelEnum = z.enum(['USUARIO','BACKOFFICE','TECNICO','ADMINISTRADOR'])

/**
 * CREATE
 * - Aluno (com RA): senha opcional, emailEducacional OU emailPessoal obrigatório
 * - Staff (sem RA): emailPessoal + senha obrigatórios
 */
export const UserCreateSchema = z.object({
  body: z.object({
    organizacaoId: z.string().cuid().optional().nullable(),

    // pra aluno você aceita sem nome no front, então deixei opcional
    nome: z.string().min(2).max(160).optional(),

    emailPessoal: z.string().email().optional(),
    emailEducacional: z.string().email().optional().nullable(),

    ra: z.string().max(32).optional().nullable(),

    papel: PapelEnum.default('USUARIO'),
    ativo: z.boolean().optional().default(true),

    // 👇 antes era obrigatório, agora é opcional
    senha: z.string().min(8).optional(),
  }).superRefine((data, ctx) => {
    const isAluno = !!data.ra;

    if (isAluno) {
      // ALUNO: precisa de algum email (educacional OU pessoal)
      if (!data.emailEducacional && !data.emailPessoal) {
        ctx.addIssue({
          code: 'custom',
          path: ['emailEducacional'],
          message: 'Aluno precisa de e-mail educacional ou pessoal.',
        });
      }
      // senha pode ser omitida – o service usa a senha padrão
      return;
    }

    // STAFF: precisa de email pessoal + senha
    if (!data.emailPessoal) {
      ctx.addIssue({
        code: 'custom',
        path: ['emailPessoal'],
        message: 'Email pessoal é obrigatório para funcionários.',
      });
    }

    if (!data.senha) {
      ctx.addIssue({
        code: 'custom',
        path: ['senha'],
        message: 'Senha é obrigatória para funcionários.',
      });
    }
  }),
})

/**
 * UPDATE – segue quase igual
 */
export const UserUpdateSchema = z.object({
  body: z.object({
    organizacaoId: z.string().cuid().optional().nullable(),
    nome: z.string().min(2).max(160).optional(),
    emailPessoal: z.string().email().optional(),
    emailEducacional: z.string().email().optional().nullable(),
    ra: z.string().max(32).optional().nullable(),
    papel: PapelEnum.optional(),
    ativo: z.boolean().optional(),
    anonimizado: z.boolean().optional(),
    senha: z.string().min(8).optional(),
  })
})

export const UserListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().gte(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().min(1).optional(),
    papel: PapelEnum.optional(),
    organizacaoId: z.string().cuid().optional(),
    ativo: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
})

export const ParamsWithIdSchema = z.object({
  params: z.object({ id: z.string().cuid() })
})
