import { z } from 'zod'

export const StatusChamadoValues = ['ABERTO','EM_ATENDIMENTO','AGUARDANDO_USUARIO','RESOLVIDO','ENCERRADO'] as const
export const NivelChamadoValues = ['N1','N2','N3'] as const
export const PrioridadeChamadoValues = ['BAIXA','MEDIA','ALTA','URGENTE'] as const

const IncludeKeysEnum = z.enum([
  'cliente',
  'contrato',
  'servico',
  'setor',
  'responsavel',
  'criadoPor',
  'historico'
]);

const IsoDate = z.string().datetime({ offset: true }).or(z.string().datetime().or(z.string())).optional()

export const ParamsWithIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
})

/**
 * Campos obrigatórios em camposEspecificos por servicoId do catálogo.
 * Mantido em sincronia com os IDs reais dos campos definidos em
 * app/(dashboard)/aluno/catalogo/[servicoId]/page.tsx no frontend.
 */
const CAMPOS_OBRIGATORIOS_POR_SERVICO: Record<string, string[]> = {
  // Secretaria
  'secretaria-declaracao-matricula':   ['finalidade'],
  'secretaria-historico-escolar':      ['semestreReferencia', 'formatoDesejado'],
  'secretaria-aproveitamento-estudos': ['instituicaoOrigem', 'disciplinasOrigem', 'disciplinasPretendidas', 'justificativa'],
  'secretaria-revisao-nota':           ['disciplina', 'avaliacao', 'justificativa'],
  'secretaria-correcao-dados-siga':    ['dadoAlterar', 'novoValor'],
  'secretaria-rematricula-fora-prazo': ['justificativa'],
  // Coordenação
  'coordenacao-duvida-matriz-curricular':              ['tipoDemanda', 'justificativa'],
  'coordenacao-reuniao':                               ['tipoDemanda', 'justificativa'],
  'coordenacao-analise-disciplina-equivalencia':       ['tipoDemanda', 'justificativa'],
  'coordenacao-orientacao-tg-tcc-projeto-integrador':  ['tipoDemanda', 'justificativa'],
  // Estágio
  'estagio-termo-compromisso': ['empresa', 'tipoEstagio', 'dataInicio', 'tipoDocumento'],
  'estagio-termo-aditivo':     ['empresa', 'tipoEstagio', 'dataInicio', 'tipoDocumento'],
  'estagio-relatorio':         ['empresa', 'tipoEstagio', 'dataInicio', 'tipoDocumento'],
  'estagio-rescisao':          ['empresa', 'tipoEstagio', 'dataInicio', 'tipoDocumento'],
  'estagio-duvida-obrigatorio-nao-obrigatorio': ['tipoEstagio', 'duvida'],
  // Sistemas / TI
  'sistemas-problema-acesso-siga':           ['tipoProblema'],
  'sistemas-dados-divergentes-siga':         ['tipoProblema'],
  'sistemas-email-institucional':            ['emailInstitucional', 'tipoProblema'],
  'sistemas-redefinicao-senha-institucional':['emailInstitucional', 'tipoProblema'],
};

const TicketBodySchema = z.object({
  titulo:    z.string().min(3),
  descricao: z.string().min(3),
  prioridade: z.enum(PrioridadeChamadoValues).optional().default('MEDIA'),
  nivel:      z.enum(NivelChamadoValues).optional().default('N1'),
  // FK fields (DB IDs)
  servicoId:     z.string().nullish(),
  setorId:       z.string().nullish(),
  clienteId:     z.string().nullish(),
  contratoId:    z.string().nullish(),
  responsavelId: z.string().nullish(),
  organizacaoId: z.string().nullish(),
  // Campos do wizard do catálogo acadêmico
  catalogoServicoId:     z.string().nullish(),
  catalogoCategoriaId:   z.string().nullish(),
  catalogoCategoriaNome: z.string().nullish(),
  categoriaId:           z.string().nullish(),
  categoriaNome:         z.string().nullish(),
  setorProvavel:         z.string().max(256).nullish(),
  dadosAcademicos:       z.record(z.unknown()).nullish(),
  camposEspecificos:     z.record(z.unknown()).nullish(),
  origem:                z.string().max(64).nullish(),
  precisaAcaoDoAluno:    z.boolean().optional(),
  planoMigracao:         z.string().nullish(),
  anexos: z.array(z.object({
    nome:    z.string(),
    tamanho: z.number(),
    tipo:    z.string(),
  })).nullish(),
}).superRefine((body, ctx) => {
  // Resolve o servicoId do catálogo (slug com hífens)
  const sid =
    body.catalogoServicoId ??
    (typeof body.servicoId === 'string' && body.servicoId.includes('-') ? body.servicoId : null);
  if (!sid) return;

  const required = CAMPOS_OBRIGATORIOS_POR_SERVICO[sid];
  if (!required?.length) return;

  const campos = (body.camposEspecificos ?? {}) as Record<string, unknown>;
  for (const key of required) {
    const val = campos[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Campo obrigatório ausente para o serviço "${sid}": "${key}"`,
        path: ['camposEspecificos', key],
      });
    }
  }
});

export const TicketCreateSchema = z.object({
  body: TicketBodySchema,
})

export const TicketUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    titulo:    z.string().min(3).optional(),
    descricao: z.string().min(3).optional(),
    prioridade: z.enum(PrioridadeChamadoValues).optional(),
    nivel:      z.enum(NivelChamadoValues).optional(),
    status:     z.enum(StatusChamadoValues).optional(),
    servicoId:     z.string().nullish(),
    setorId:       z.string().nullish(),
    clienteId:     z.string().nullish(),
    contratoId:    z.string().nullish(),
    responsavelId: z.string().nullish(),
    organizacaoId: z.string().nullish(),
    precisaAcaoDoAluno: z.boolean().optional(),
    observacaoInterna:  z.string().max(4000).nullish(),
    slaHoras: z.number().int().positive().nullish(),
    slaDias:  z.number().int().positive().nullish(),
    vencimentoSla: z.string().datetime().nullish(),
  }).refine(
    (b) => Object.keys(b).length > 0,
    { message: 'Nenhum campo para atualizar' },
  ),
})

export const TicketListSchema = z.object({
  query: z.object({
    page:     z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
    search:   z.string().optional(),
    status:    z.union([z.enum(StatusChamadoValues), z.array(z.enum(StatusChamadoValues))]).optional(),
    nivel:     z.union([z.enum(NivelChamadoValues),  z.array(z.enum(NivelChamadoValues))]).optional(),
    prioridade: z.union([z.enum(PrioridadeChamadoValues), z.array(z.enum(PrioridadeChamadoValues))]).optional(),
    clienteId:     z.string().optional(),
    contratoId:    z.string().optional(),
    setorId:       z.string().optional(),
    servicoId:     z.string().optional(),
    responsavelId: z.string().optional(),
    organizacaoId: z.string().optional(),
    criadoPorId:   z.string().optional(),
    criadoDe:  IsoDate,
    criadoAte: IsoDate,
    orderBy:  z.enum(['criadoEm','atualizadoEm']).default('criadoEm').optional(),
    orderDir: z.enum(['asc','desc']).default('desc').optional(),
    include: z
      .union([
        z.array(IncludeKeysEnum),
        z.string()
         .transform((s) => s.split(',').map((x) => x.trim()))
         .pipe(z.array(IncludeKeysEnum))
      ])
      .optional(),
  }),
});
