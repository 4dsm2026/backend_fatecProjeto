// src/core/users/users.service.ts
import type { PrismaClient, Prisma } from '@prisma/client';
import type {
  UserCreateDTO,
  UserListQuery,
  UserResponse,
  UserUpdateDTO,
  Paginated,
} from '../../types/users';
import { hashPassword } from '../../security/password';

const baseSelect = {
  id: true,
  organizacaoId: true,
  nome: true,
  emailPessoal: true,
  emailEducacional: true,
  ra: true,
  cursoNome: true,
  cursoSigla: true,
  papel: true,
  ativo: true,
  anonimizado: true,
  criadoEm: true,
  atualizadoEm: true,
  deletadoEm: true,
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
} satisfies Prisma.UsuarioSelect;

async function logAuditoria(
  prisma: PrismaClient,
  acao: string,
  alvo?: string,
  meta?: any,
  feitoPorId?: string,
) {
  try {
    await prisma.auditoria.create({ data: { acao, alvo, meta, feitoPorId } });
  } catch {
    // Auditoria não deve quebrar o fluxo principal
  }
}

type ServiceOpts = { feitoPorId?: string; meta?: any };

export async function createUser(
  prisma: PrismaClient,
  data: UserCreateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const d = data as any;
  const isAluno = !!data.ra;

  if (!data.nome) throw new Error('Nome é obrigatório.');
  if (!data.emailPessoal && !data.emailEducacional)
    throw new Error('É obrigatório informar e-mail pessoal ou educacional.');

  const senhaPlano = d.senha ?? process.env.DEFAULT_TEMP_PASSWORD;
  if (!senhaPlano) {
    throw new Error('DEFAULT_TEMP_PASSWORD é obrigatória quando a senha não é informada.');
  }
  const senhaHash = await hashPassword(senhaPlano);

  const created = await prisma.usuario.create({
    data: {
      nome: data.nome,
      emailPessoal: (data.emailPessoal ?? data.emailEducacional)!,
      emailEducacional: data.emailEducacional ?? null,
      ra: data.ra ?? null,
      cursoNome:  d.cursoNome  ?? null,
      cursoSigla: d.cursoSigla ?? null,
      senhaHash,
      papel: (data.papel as any) ?? 'USUARIO',
      ativo: data.ativo ?? true,
      precisaTrocarSenha: isAluno,
      organizacaoId: data.organizacaoId ?? null,
      // Dados acadêmicos opcionais
      unidadeFatec:        d.unidadeFatec        ?? null,
      turno:               d.turno               ?? null,
      turma:               d.turma               ?? null,
      semestreAtual:       d.semestreAtual       ?? null,
      anoSemestreIngresso: d.anoSemestreIngresso ?? null,
    },
    select: baseSelect,
  });

  await logAuditoria(
    prisma,
    'USUARIO_CRIADO',
    `usuarios:${created.id}`,
    { user: created, origem: opts?.meta?.origem ?? 'service:createUser', isAluno },
    opts?.feitoPorId,
  );

  return created as unknown as UserResponse;
}

export async function getUserById(
  prisma: PrismaClient,
  id: string,
): Promise<(UserResponse & { deletadoEm: Date | null }) | null> {
  return prisma.usuario.findUnique({ where: { id }, select: baseSelect }) as any;
}

export async function listUsers(
  prisma: PrismaClient,
  q: UserListQuery,
): Promise<Paginated<UserResponse>> {
  const where: Prisma.UsuarioWhereInput = {
    deletadoEm: null,
    ...(q.papel ? { papel: q.papel as any } : {}),
    ...(q.organizacaoId ? { organizacaoId: q.organizacaoId } : {}),
    ...(typeof q.ativo !== 'undefined' ? { ativo: q.ativo === 'true' } : {}),
    ...(q.q
      ? {
          OR: [
            { nome: { contains: q.q } },
            { emailPessoal: { contains: q.q } },
            { emailEducacional: { contains: q.q } },
            { ra: { contains: q.q } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.usuario.findMany({
      where,
      select: baseSelect,
      orderBy: { criadoEm: 'desc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
    }),
    prisma.usuario.count({ where }),
  ]);

  return {
    items: items as any,
    page: q.page,
    perPage: q.perPage,
    total,
    pages: Math.ceil(total / q.perPage),
  };
}

export async function updateUser(
  prisma: PrismaClient,
  id: string,
  data: UserUpdateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const d = data as any;

  const patch: Prisma.UsuarioUncheckedUpdateInput = {
    nome:            data.nome            ?? undefined,
    emailPessoal:    data.emailPessoal    ?? undefined,
    emailEducacional: data.emailEducacional ?? undefined,
    ra:              data.ra              ?? undefined,
    cursoNome:       d.cursoNome          ?? undefined,
    cursoSigla:      d.cursoSigla         ?? undefined,
    papel:           (data.papel as any)  ?? undefined,
    ativo:           typeof data.ativo === 'boolean'      ? data.ativo      : undefined,
    anonimizado:     typeof data.anonimizado === 'boolean' ? data.anonimizado : undefined,
    // Dados acadêmicos
    unidadeFatec:        d.unidadeFatec        ?? undefined,
    curso:               d.curso               ?? undefined,
    eixoTecnologico:     d.eixoTecnologico     ?? undefined,
    turno:               d.turno               ?? undefined,
    turma:               d.turma               ?? undefined,
    semestreAtual:       d.semestreAtual       ?? undefined,
    matrizCurricular:    d.matrizCurricular    ?? undefined,
    situacaoAcademica:   d.situacaoAcademica   ?? undefined,
    anoSemestreIngresso: d.anoSemestreIngresso ?? undefined,
    coordenadorCurso:    d.coordenadorCurso    ?? undefined,
    // Contato e acessibilidade
    telefoneCelular:               d.telefoneCelular               ?? undefined,
    whatsapp:                      d.whatsapp                      ?? undefined,
    canalPreferencialContato:      d.canalPreferencialContato      ?? undefined,
    melhorPeriodoContato:          d.melhorPeriodoContato          ?? undefined,
    necessitaAtendimentoAcessivel: typeof d.necessitaAtendimentoAcessivel === 'boolean'
      ? d.necessitaAtendimentoAcessivel : undefined,
    tipoAcessibilidade:      d.tipoAcessibilidade      ?? undefined,
    observacoesAtendimento:  d.observacoesAtendimento  ?? undefined,
    notificacoesInApp:       typeof d.notificacoesInApp === 'boolean' ? d.notificacoesInApp : undefined,
  };

  if ('organizacaoId' in data) patch.organizacaoId = data.organizacaoId as any;
  if (d.senha) patch.senhaHash = await hashPassword(d.senha);

  const before = await prisma.usuario.findUnique({ where: { id }, select: baseSelect });
  const updated = await prisma.usuario.update({ where: { id }, data: patch, select: baseSelect });

  await logAuditoria(
    prisma,
    'USUARIO_ATUALIZADO',
    `usuarios:${id}`,
    { changes: Object.keys(patch), before, after: updated, origem: opts?.meta?.origem ?? 'service:updateUser' },
    opts?.feitoPorId,
  );

  return updated as any;
}

export async function softDeleteUser(
  prisma: PrismaClient,
  id: string,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const before = await prisma.usuario.findUnique({ where: { id }, select: baseSelect });
  if (!before) {
    const err: any = new Error('Usuário não encontrado');
    err.code = 'P2025';
    throw err;
  }

  const anonDomain = process.env.ANON_EMAIL_DOMAIN ?? 'anon.local';
  const anonEduDomain = process.env.ANON_EDU_DOMAIN ?? 'anon.edu.local';

  const deleted = await prisma.usuario.update({
    where: { id },
    data: {
      deletadoEm: new Date(),
      ativo: false,
      anonimizado: true,
      nome: 'Usuário Anônimo',
      ra: (before as any).ra ? `anon_${id}` : null,
      emailPessoal: `anonp_${id}@${anonDomain}`,
      emailEducacional: (before as any).emailEducacional ? `anone_${id}@${anonEduDomain}` : null,
      telefoneCelular: null,
      whatsapp: null,
      observacoesAtendimento: null,
    },
    select: baseSelect,
  });

  await logAuditoria(
    prisma,
    'USUARIO_REMOVIDO_SOFT',
    `usuarios:${id}`,
    { before, after: deleted, origem: opts?.meta?.origem ?? 'service:softDeleteUser' },
    opts?.feitoPorId,
  );

  return deleted as any;
}
