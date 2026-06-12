export const IDS = {
  admin: 'admin-id-001',
  user: 'user-id-001',
  aluno: 'aluno-id-001',
  ticket: 'ticket-id-001',
  setor: 'setor-id-001',
  categoria: 'cat-id-001',
  servico: 'svc-id-001',
} as const

export function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: IDS.user,
    nome: 'João Silva',
    emailPessoal: 'joao@example.com',
    emailEducacional: null,
    ra: null,
    cursoNome: null,
    cursoSigla: null,
    papel: 'USUARIO',
    ativo: true,
    anonimizado: false,
    criadoEm: new Date('2024-01-01T00:00:00.000Z'),
    atualizadoEm: new Date('2024-01-01T00:00:00.000Z'),
    deletadoEm: null,
    organizacaoId: null,
    unidadeFatec: null,
    curso: null,
    eixoTecnologico: null,
    turno: null,
    turma: null,
    semestreAtual: null,
    matrizCurricular: null,
    situacaoAcademica: null,
    anoSemestreIngresso: null,
    coordenadorCurso: null,
    telefoneCelular: null,
    whatsapp: null,
    canalPreferencialContato: null,
    melhorPeriodoContato: null,
    necessitaAtendimentoAcessivel: false,
    tipoAcessibilidade: null,
    observacoesAtendimento: null,
    ...overrides,
  }
}

export function makeAluno(overrides: Record<string, any> = {}) {
  return makeUser({
    id: IDS.aluno,
    nome: 'Maria Aluna',
    emailPessoal: 'maria@example.com',
    emailEducacional: 'maria@fatec.sp.gov.br',
    ra: '1234567',
    papel: 'USUARIO',
    unidadeFatec: 'FATEC São Paulo',
    turno: 'Manhã',
    turma: '3SEM',
    semestreAtual: '3',
    ...overrides,
  })
}

export function makeLoginUser(overrides: Record<string, any> = {}) {
  return {
    id: IDS.user,
    nome: 'João Silva',
    ra: null,
    papel: 'USUARIO',
    senhaHash: '$argon2id$v=19$m=65536,t=3,p=4$placeholder-for-tests',
    emailPessoal: 'joao@example.com',
    ativo: true,
    loginAttempts: 0,
    lockedUntil: null,
    lastFailedAttempt: null,
    precisaTrocarSenha: false,
    ...overrides,
  }
}

export function makeTicket(overrides: Record<string, any> = {}) {
  return {
    id: IDS.ticket,
    titulo: 'Problema de acesso ao portal',
    descricao: 'Não consigo logar no portal do aluno',
    protocolo: 'TCK-ABC123',
    status: 'ABERTO',
    nivel: 'N1',
    prioridade: 'MEDIA',
    criadoPorId: IDS.user,
    organizacaoId: null,
    servicoId: null,
    setorId: null,
    responsavelId: null,
    catalogoServicoId: null,
    catalogoCategoriaNome: null,
    catalogoCategoriaId: null,
    setorProvavel: null,
    categoriaId: null,
    categoriaNome: null,
    deletadoEm: null,
    criadoEm: new Date('2024-01-01T00:00:00.000Z'),
    atualizadoEm: new Date('2024-01-01T00:00:00.000Z'),
    setor: null,
    criadoPor: { id: IDS.user, nome: 'João Silva' },
    ...overrides,
  }
}

export function makeSetor(overrides: Record<string, any> = {}) {
  return {
    id: IDS.setor,
    nome: 'Tecnologia da Informação',
    descricao: 'Setor responsável por suporte de TI',
    organizacaoId: null,
    ...overrides,
  }
}

export function makeCategoria(overrides: Record<string, any> = {}) {
  return {
    id: IDS.categoria,
    nome: 'Acesso e Autenticação',
    descricao: 'Serviços relacionados a acesso e autenticação',
    organizacaoId: null,
    servicos: [
      {
        id: IDS.servico,
        nome: 'Redefinição de Senha',
        descricao: 'Redefinição de senha do portal',
        ativo: true,
        categoriaId: IDS.categoria,
      },
    ],
    ...overrides,
  }
}
