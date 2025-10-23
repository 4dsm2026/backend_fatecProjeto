export type PapelCreateBody = {
  nome: string;
  descricao?: string | null;
};
export type PapelUpdateBody = Partial<PapelCreateBody>;
export type ParamsWithId = { id: string };
