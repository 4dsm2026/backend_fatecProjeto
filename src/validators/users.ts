import { z } from 'zod'

export const PapelEnum = z.enum(['USUARIO','BACKOFFICE','TECNICO','ADMINISTRADOR'])

export const UserCreateSchema = z.object({
  body: z.object({
    organizacaoId: z.string().min(1).optional().nullable(),
    nome: z.string().min(2).max(160).optional(),
    emailPessoal: z.string().email().optional(),
    emailEducacional: z.string().email().optional().nullable(),
    ra: z.string().max(32).optional().nullable(),
    papel: PapelEnum.default('USUARIO'),
    ativo: z.boolean().optional().default(true),
    senha: z.string().min(8).optional(),
    // Dados do curso
    cursoNome:  z.string().max(128).optional().nullable(),
    cursoSigla: z.string().max(16).optional().nullable(),
    // Dados acadêmicos (preenchidos pelo admin no cadastro/importação)
    unidadeFatec:        z.string().max(128).optional().nullable(),
    turno:               z.string().max(64).optional().nullable(),
    turma:               z.string().max(64).optional().nullable(),
    semestreAtual:       z.string().max(32).optional().nullable(),
    anoSemestreIngresso: z.string().max(32).optional().nullable(),
  }).superRefine((data, ctx) => {
    const isAluno = !!data.ra;
    if (isAluno) {
      if (!data.emailEducacional && !data.emailPessoal) {
        ctx.addIssue({
          code: 'custom',
          path: ['emailEducacional'],
          message: 'Aluno precisa de e-mail educacional ou pessoal.',
        });
      }
      return;
    }
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

export const UserUpdateSchema = z.object({
  body: z.object({
    organizacaoId: z.string().min(1).optional().nullable(),
    nome: z.string().min(2).max(160).optional(),
    emailPessoal: z.string().email().optional(),
    emailEducacional: z.string().email().optional().nullable(),
    ra: z.string().max(32).optional().nullable(),
    papel: PapelEnum.optional(),
    ativo: z.boolean().optional(),
    anonimizado: z.boolean().optional(),
    senha: z.string().min(8).optional(),

    // Dados do curso
    cursoNome:  z.string().max(128).optional().nullable(),
    cursoSigla: z.string().max(16).optional().nullable(),

    // Dados acadêmicos (gerenciados pelo admin)
    unidadeFatec:        z.string().max(128).optional().nullable(),
    curso:               z.string().max(128).optional().nullable(),
    eixoTecnologico:     z.string().max(128).optional().nullable(),
    turno:               z.string().max(64).optional().nullable(),
    turma:               z.string().max(64).optional().nullable(),
    semestreAtual:       z.string().max(32).optional().nullable(),
    matrizCurricular:    z.string().max(128).optional().nullable(),
    situacaoAcademica:   z.string().max(128).optional().nullable(),
    anoSemestreIngresso: z.string().max(32).optional().nullable(),
    coordenadorCurso:    z.string().max(128).optional().nullable(),

    // Contato e acessibilidade (editável pelo aluno)
    telefoneCelular:               z.string().max(20).optional().nullable(),
    whatsapp:                      z.string().max(20).optional().nullable(),
    canalPreferencialContato:      z.string().max(64).optional().nullable(),
    melhorPeriodoContato:          z.string().max(64).optional().nullable(),
    necessitaAtendimentoAcessivel: z.boolean().optional(),
    tipoAcessibilidade:            z.string().max(256).optional().nullable(),
    observacoesAtendimento:        z.string().max(2000).optional().nullable(),
    notificacoesInApp:             z.boolean().optional(),
  })
})

export const UserListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().gte(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().min(1).optional(),
    papel: PapelEnum.optional(),
    organizacaoId: z.string().min(1).optional(),
    ativo: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
})

export const ParamsWithIdSchema = z.object({
  params: z.object({ id: z.string().min(1) })
})
