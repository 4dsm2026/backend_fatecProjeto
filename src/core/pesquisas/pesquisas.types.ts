import type { StatusPesquisa, TipoPergunta } from "./pesquisas.rules";

export type PerguntaInput = {
  secao?: string | null;
  texto: string;
  tipo: TipoPergunta;
  opcoes?: string[] | null;
  obrigatoria: boolean;
};

export type PesquisaCreateInput = {
  titulo: string;
  descricao?: string | null;
  semestre: string;
  cursos?: string[] | null;
  fechaEm?: Date | null;
  perguntas?: PerguntaInput[];
  /** Sem `perguntas`: começa pelo modelo da CPA (padrão) ou em branco. */
  modelo: boolean;
};

export type PesquisaUpdateInput = {
  titulo?: string;
  descricao?: string | null;
  semestre?: string;
  cursos?: string[] | null;
  fechaEm?: Date | null;
  perguntas?: PerguntaInput[];
};

export type PesquisaCopyInput = { semestre: string; titulo?: string };

export type PesquisaListQuery = {
  page: number;
  size: number;
  semestre?: string;
  status?: StatusPesquisa;
};

export type ValorResposta = number | string;
export type RespostasInput = Record<string, ValorResposta | null | undefined>;

/* ===== Resultados ===== */

export type ResultadoPergunta = {
  id: string;
  ordem: number;
  secao: string | null;
  texto: string;
  tipo: TipoPergunta;
  respostas: number;
  /** ESCALA: média de 1 a 5 (sem os "não sei"), ou null se ninguém avaliou. */
  media?: number | null;
  /** ESCALA: quantos em cada nota, de 1 a 5. */
  distribuicao?: Record<string, number>;
  naoSei?: number;
  /** MULTIPLA: quantos em cada opção. */
  opcoes?: { opcao: string; total: number }[];
  /** TEXTO: respostas abertas, em ordem alfabética (não a de envio). */
  textos?: string[];
};

export type ParticipacaoCurso = { curso: string; elegiveis: number; respondentes: number };

export type ResultadosPesquisa = {
  pesquisaId: string;
  curso: string | null;
  minimo: number;
  totalRespostas: number;
  totalElegiveis: number;
  participacao: ParticipacaoCurso[];
  /** true: respostas insuficientes neste recorte; `perguntas` vem vazio. */
  suprimido: boolean;
  perguntas: ResultadoPergunta[];
};
