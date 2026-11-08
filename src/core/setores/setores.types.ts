export type SetorCreateBody = {
  nome: string;
  descricao?: string | null;
  organizacaoId?: string | null;
};

export type SetorUpdateBody = Partial<SetorCreateBody>;

export type SetoresListQuery = {
  /** Página base 0. */
  page?: number;
  size?: number;
  search?: string;
  organizacaoId?: string;
};

export type ParamsWithId = { id: string };
