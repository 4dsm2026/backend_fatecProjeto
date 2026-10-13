// src/core/users/users.service.ts
import type { PrismaClient, Prisma } from '@prisma/client';
import { ApiError, toSkipTake } from '../../hateoas';
import type {
  UserCreateDTO,
  UserResponse,
  UserUpdateDTO,
} from '../../types/users';
import type { UserListResult, UsersListQuery } from './users.types';
import { userPublicSelect } from './users.types';
import { hashPassword } from '../../security/password';

async function logAuditoria(
  prisma: PrismaClient,
  acao: string,
  alvo?: string,
  meta: object = {},
  feitoPorId?: string,
) {
  try {
    await prisma.auditoria.create({
      data: {
        acao,
        alvo,
        feitoPorId,
        meta: serializeMeta(meta),
      },
    });
  } catch {
    return;
  }
}

type ServiceOpts = { feitoPorId?: string; meta?: { origem?: string } };

function serializeMeta(meta: object): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonObject;
}

async function buildUserPatch(data: UserUpdateDTO): Promise<Prisma.UsuarioUncheckedUpdateInput> {
  const patch: Prisma.UsuarioUncheckedUpdateInput = {
    nome: data.nome,
    emailPessoal: data.emailPessoal,
    emailEducacional: data.emailEducacional ?? undefined,
    ra: data.ra,
    cursoNome: data.cursoNome,
    cursoSigla: data.cursoSigla,
    papel: data.papel,
    ativo: data.ativo,
    anonimizado: data.anonimizado,
    organizacaoId: data.organizacaoId,
    unidadeFatec: data.unidadeFatec,
    curso: data.curso,
    eixoTecnologico: data.eixoTecnologico,
    turno: data.turno,
    turma: data.turma,
    semestreAtual: data.semestreAtual,
    matrizCurricular: data.matrizCurricular,
    situacaoAcademica: data.situacaoAcademica,
    anoSemestreIngresso: data.anoSemestreIngresso,
    coordenadorCurso: data.coordenadorCurso,
    telefoneCelular: data.telefoneCelular,
    whatsapp: data.whatsapp,
    canalPreferencialContato: data.canalPreferencialContato,
    melhorPeriodoContato: data.melhorPeriodoContato,
    necessitaAtendimentoAcessivel: data.necessitaAtendimentoAcessivel,
    tipoAcessibilidade: data.tipoAcessibilidade,
    observacoesAtendimento: data.observacoesAtendimento,
    notificacoesInApp: data.notificacoesInApp,
  };

  if (data.senha) patch.senhaHash = await hashPassword(data.senha);

  return patch;
}

export async function createUser(
  prisma: PrismaClient,
  data: UserCreateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const isAluno = !!data.ra;

  if (!data.nome) throw new ApiError('bad-request', 'Nome é obrigatório.');
  const emailPessoal = data.emailPessoal ?? data.emailEducacional;
  if (!emailPessoal) throw new ApiError('bad-request', 'É obrigatório informar e-mail pessoal ou educacional.');

  const senhaPlano = data.senha ?? process.env.DEFAULT_TEMP_PASSWORD;
  if (!senhaPlano) {
    throw new Error('DEFAULT_TEMP_PASSWORD é obrigatória quando a senha não é informada.');
  }
  const senhaHash = await hashPassword(senhaPlano);

  const created = await prisma.usuario.create({
    data: {
      nome: data.nome,
      emailPessoal,
      emailEducacional: data.emailEducacional ?? null,
      ra: data.ra ?? null,
      cursoNome: data.cursoNome ?? null,
      cursoSigla: data.cursoSigla ?? null,
      senhaHash,
      papel: data.papel,
      ativo: data.ativo,
      precisaTrocarSenha: isAluno,
      organizacaoId: data.organizacaoId ?? null,
      unidadeFatec: data.unidadeFatec ?? null,
      turno: data.turno ?? null,
      turma: data.turma ?? null,
      semestreAtual: data.semestreAtual ?? null,
      anoSemestreIngresso: data.anoSemestreIngresso ?? null,
    },
    select: userPublicSelect,
  });

  await logAuditoria(
    prisma,
    'USUARIO_CRIADO',
    `usuarios:${created.id}`,
    { user: created, origem: opts?.meta?.origem ?? 'service:createUser', isAluno },
    opts?.feitoPorId,
  );

  return created;
}

export async function getUserById(
  prisma: PrismaClient,
  id: string,
): Promise<(UserResponse & { deletadoEm: Date | null }) | null> {
  return prisma.usuario.findUnique({ where: { id }, select: userPublicSelect });
}

export async function listUsers(
  prisma: PrismaClient,
  q: UsersListQuery,
): Promise<UserListResult> {
  const where: Prisma.UsuarioWhereInput = {
    deletadoEm: null,
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
  const { skip, take } = toSkipTake(q);

  const [items, total] = await Promise.all([
    prisma.usuario.findMany({
      where,
      select: userPublicSelect,
      orderBy: { criadoEm: 'desc' },
      skip,
      take,
    }),
    prisma.usuario.count({ where }),
  ]);

  return { items, total };
}

export async function updateUser(
  prisma: PrismaClient,
  id: string,
  data: UserUpdateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const patch = await buildUserPatch(data);

  const before = await prisma.usuario.findUnique({ where: { id }, select: userPublicSelect });
  if (!before) throw new ApiError('not-found', 'Usuário não encontrado');
  if (before.deletadoEm !== null) throw new ApiError('conflict', 'Usuário removido não pode ser atualizado');
  const updated = await prisma.usuario.update({ where: { id }, data: patch, select: userPublicSelect });

  await logAuditoria(
    prisma,
    'USUARIO_ATUALIZADO',
    `usuarios:${id}`,
    { changes: Object.keys(patch), before, after: updated, origem: opts?.meta?.origem ?? 'service:updateUser' },
    opts?.feitoPorId,
  );

  return updated;
}

export async function softDeleteUser(
  prisma: PrismaClient,
  id: string,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const before = await prisma.usuario.findUnique({ where: { id }, select: userPublicSelect });
  if (!before) throw new ApiError('not-found', 'Usuário não encontrado');
  if (before.deletadoEm !== null) throw new ApiError('conflict', 'Usuário já removido');

  const anonDomain = process.env.ANON_EMAIL_DOMAIN ?? 'anon.local';
  const anonEduDomain = process.env.ANON_EDU_DOMAIN ?? 'anon.edu.local';

  const deleted = await prisma.usuario.update({
    where: { id },
    data: {
      deletadoEm: new Date(),
      ativo: false,
      anonimizado: true,
      nome: 'Usuário Anônimo',
      ra: before.ra ? `anon_${id}` : null,
      emailPessoal: `anonp_${id}@${anonDomain}`,
      emailEducacional: before.emailEducacional ? `anone_${id}@${anonEduDomain}` : null,
      telefoneCelular: null,
      whatsapp: null,
      observacoesAtendimento: null,
    },
    select: userPublicSelect,
  });

  await logAuditoria(
    prisma,
    'USUARIO_REMOVIDO_SOFT',
    `usuarios:${id}`,
    { before, after: deleted, origem: opts?.meta?.origem ?? 'service:softDeleteUser' },
    opts?.feitoPorId,
  );

  return deleted;
}
