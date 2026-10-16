export type StatusSugestao = 'NAO_RESPONDIDO' | 'RESPONDIDO'

export type SugestaoCreateInput = {
  emailContato: string
  conteudo: string
}

export type SugestoesListQuery = {
  page: number
  size: number
  status?: StatusSugestao
}

export type SugestaoResponderInput = {
  resposta?: string
  status?: StatusSugestao
}
