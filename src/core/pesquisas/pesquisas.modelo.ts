import type { PerguntaInput } from "./pesquisas.types";

const escala = (secao: string, texto: string): PerguntaInput => ({ secao, texto, tipo: "ESCALA", obrigatoria: true });

/**
 * Modelo inicial de autoavaliação institucional, organizado por dimensões
 * próximas às do SINAES. É um ponto de partida: a CPA edita antes de abrir.
 */
export const MODELO_CPA: readonly PerguntaInput[] = [
  escala("Curso e ensino", "As disciplinas do semestre contribuem para a sua formação profissional."),
  escala("Curso e ensino", "A carga de atividades e avaliações é adequada."),
  escala("Curso e ensino", "A coordenação do curso está acessível e resolve as demandas dos alunos."),

  escala("Professores", "Os professores dominam o conteúdo e explicam com clareza."),
  escala("Professores", "Os professores cumprem o plano de ensino e os horários."),
  escala("Professores", "Os critérios de avaliação são claros e as devolutivas ajudam a aprender."),

  escala("Infraestrutura", "Salas de aula (conforto, limpeza, equipamentos)."),
  escala("Infraestrutura", "Laboratórios e equipamentos de informática."),
  escala("Infraestrutura", "Biblioteca (acervo, espaço, horário)."),
  escala("Infraestrutura", "Internet e sistemas institucionais (SIGA, e-mail, Teams)."),

  escala("Atendimento", "Atendimento da Secretaria Acadêmica."),
  escala("Atendimento", "Comunicação da Fatec com os alunos (avisos, prazos, eventos)."),

  {
    secao: "Você no curso",
    texto: "Você pretende concluir o curso na Fatec?",
    tipo: "MULTIPLA",
    opcoes: ["Sim, com certeza", "Provavelmente sim", "Tenho dúvidas", "Penso em trancar ou sair"],
    obrigatoria: true,
  },
  {
    secao: "Você no curso",
    texto: "Se pensa em trancar ou sair, qual o principal motivo?",
    tipo: "MULTIPLA",
    opcoes: ["Trabalho / horário", "Dificuldade financeira", "Dificuldade com as disciplinas", "Transporte / distância", "O curso não é o que eu esperava", "Outro"],
    obrigatoria: false,
  },

  { secao: "Em aberto", texto: "O que a Fatec deveria melhorar primeiro?", tipo: "TEXTO", obrigatoria: false },
  { secao: "Em aberto", texto: "O que você mais valoriza na Fatec?", tipo: "TEXTO", obrigatoria: false },
];
