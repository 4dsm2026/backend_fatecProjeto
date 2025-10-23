export type SetorCreateBody = {
  nome: string;
  descricao?: string | null;
  organizacaoId?: string | null;
};

export type SetorUpdateBody = Partial<SetorCreateBody>;

export type SetoresListQuery = {
  page?: number;
  perPage?: number;
  search?: string;
  organizacaoId?: string;
};

export type ParamsWithId = { id: string };
