// src/core/auth/user-public.ts
/**
 * Campos públicos do usuário (nunca inclui senhaHash). Fonte única: usada por
 * /auth/me (legado), /users/me e /auth/usuarios.
 */
export const userPublicSelect = {
  id: true,
  nome: true,
  emailPessoal: true,
  emailEducacional: true,
  ra: true,
  cursoNome: true,
  cursoSigla: true,
  papel: true,
  ativo: true,
  precisaTrocarSenha: true,
  passwordUpdatedAt: true,
  criadoEm: true,
  atualizadoEm: true,
  // Dados acadêmicos
  unidadeFatec: true,
  curso: true,
  eixoTecnologico: true,
  turno: true,
  turma: true,
  semestreAtual: true,
  matrizCurricular: true,
  situacaoAcademica: true,
  anoSemestreIngresso: true,
  coordenadorCurso: true,
  // Contato e acessibilidade
  telefoneCelular: true,
  whatsapp: true,
  canalPreferencialContato: true,
  melhorPeriodoContato: true,
  necessitaAtendimentoAcessivel: true,
  tipoAcessibilidade: true,
  observacoesAtendimento: true,
  notificacoesInApp: true,
} as const;
