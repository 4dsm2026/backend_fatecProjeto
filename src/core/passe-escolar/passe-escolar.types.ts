import type { StatusPasseEscolar } from "./passe-escolar.rules";

export type ModalidadePasseEscolar = "PASSE_LIVRE" | "MEIA_TARIFA";
export type TipoPedidoPasseEscolar = "NOVO" | "REVALIDACAO";

/** Dados que o aluno informa (os mesmos que a Fatec lança no portal da EMTU). */
export type PasseEscolarDadosInput = {
  nomeCompleto: string;
  rg: string;
  cpf: string;
  cep: string;
  municipioResidencia: string;
  curso: string;
  periodo: string;
  mesConclusao: number;
  anoConclusao: number;
  declaraBaixaRenda: boolean;
  observacaoAluno?: string | null;
};

export type PasseEscolarCreateInput = PasseEscolarDadosInput & {
  anoReferencia?: number;
  tipo: TipoPedidoPasseEscolar;
  modalidade: ModalidadePasseEscolar;
};

export type PasseEscolarUpdateInput = Partial<PasseEscolarDadosInput> & {
  modalidade?: ModalidadePasseEscolar;
  tipo?: TipoPedidoPasseEscolar;
};

export type PasseEscolarTransitionInput = {
  status: StatusPasseEscolar;
  comentario?: string;
  protocoloEmtu?: string;
};

export type PasseEscolarListQuery = {
  page: number;
  size: number;
  status?: StatusPasseEscolar[];
  ano?: number;
  /** `true` = só pedidos em andamento (padrão da tela da secretaria). */
  ativos?: boolean;
  search?: string;
};

export type PasseEscolarExportQuery = {
  ano?: number;
  status?: StatusPasseEscolar[];
};
