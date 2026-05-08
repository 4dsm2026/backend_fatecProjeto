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

export const TicketCreateSchema = z.object({
  body: z.object({
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
    categoriaId:           z.string().nullish(),   // alias enviado pelo wizard
    categoriaNome:         z.string().nullish(),   // alias enviado pelo wizard
    setorProvavel:         z.string().max(256).nullish(),
    dadosAcademicos:       z.record(z.unknown()).nullish(),
    camposEspecificos:     z.record(z.unknown()).nullish(),
    origem:                z.string().max(64).nullish(),
    precisaAcaoDoAluno:    z.boolean().optional(),
    // Campos aceitos mas ignorados (planejamento de migração)
    planoMigracao:         z.string().nullish(),
    anexos: z.array(z.object({
      nome:    z.string(),
      tamanho: z.number(),
      tipo:    z.string(),
    })).nullish(),
  }),
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
