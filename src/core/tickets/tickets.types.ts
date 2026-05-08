import { NivelChamado, PrioridadeChamado, StatusChamado } from '@prisma/client'

export type TicketsListQuery = {
  page?: number
  pageSize?: number
  search?: string
  status?: StatusChamado | StatusChamado[]
  nivel?: NivelChamado | NivelChamado[]
  prioridade?: PrioridadeChamado | PrioridadeChamado[]
  clienteId?: string
  contratoId?: string
  setorId?: string
  servicoId?: string
  responsavelId?: string
  organizacaoId?: string
  criadoDe?: string
  criadoAte?: string
  orderBy?: 'criadoEm' | 'atualizadoEm'
  orderDir?: 'asc' | 'desc'
  criadoPorId?: string
  include?: ('cliente' | 'contrato' | 'servico' | 'setor' | 'responsavel' | 'criadoPor' | 'historico')[]
}

export type TicketCreateInput = {
  titulo: string
  descricao: string
  prioridade?: PrioridadeChamado
  nivel?: NivelChamado
  // DB FK fields (IDs de registros do banco)
  servicoId?: string | null
  setorId?: string | null
  clienteId?: string | null
  contratoId?: string | null
  responsavelId?: string | null
  organizacaoId?: string | null
  // Campos do wizard do catálogo acadêmico
  catalogoServicoId?: string | null     // slug do catálogo (ex: "secretaria-declaracao-matricula")
  catalogoCategoriaId?: string | null   // slug da categoria (ex: "secretaria-academica")
  catalogoCategoriaNome?: string | null
  categoriaId?: string | null           // alias de catalogoCategoriaId enviado pelo wizard
  categoriaNome?: string | null         // alias de catalogoCategoriaNome
  setorProvavel?: string | null
  dadosAcademicos?: Record<string, unknown> | null
  camposEspecificos?: Record<string, unknown> | null
  origem?: string | null
  precisaAcaoDoAluno?: boolean
}

export type TicketUpdateInput = Partial<TicketCreateInput> & {
  status?: StatusChamado
}
