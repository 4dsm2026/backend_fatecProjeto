import type { SugestaoDocumento } from '../../validators/sugestao-documento'

export type StatusSugestao = 'NAO_RESPONDIDO' | 'RESPONDIDO'

export type SugestaoCreateInput = {
  emailContato: string
  conteudo: string
  documento?: SugestaoDocumento
}

export type SugestoesListQuery = {
  page?: number
  pageSize?: number
  status?: StatusSugestao
}

export type SugestaoResponderInput = {
  resposta?: string
  status?: StatusSugestao
}