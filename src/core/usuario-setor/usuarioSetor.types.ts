export type VincularBody = {
  setorId: string;
  papelId?: string | null;
};
export type AlterarPapelBody = {
  papelId?: string | null;
};
export type ListUsuariosDoSetorQuery = {
  page?: number;
  perPage?: number;
  search?: string;
};
export type ListSetoresDoUsuarioQuery = {
  page?: number;
  perPage?: number;
};
export type ParamsWithUsuarioId = { usuarioId: string };
export type ParamsWithUsuarioSetorId = { usuarioSetorId: string };
export type ParamsWithSetorId = { setorId: string };
