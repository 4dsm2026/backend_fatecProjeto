// core/users/users.service.ts
import type { PrismaClient, Prisma } from '@prisma/client'
import type {
  UserCreateDTO,
  UserListQuery,
  UserResponse,
  UserUpdateDTO,
  Paginated,
} from '../../types/users'
import { hashPassword } from '../../security/password'
import { enviarLinkPrimeiroAcesso } from '../auth/reset-senha.service' 


const baseSelect = {
  id: true,
  organizacaoId: true,
  nome: true,
  emailPessoal: true,
  emailEducacional: true,
  ra: true,
  cursoNome: true,          // 👈 incluído
  cursoSigla: true,         // 👈 incluído
  papel: true,
  ativo: true,
  anonimizado: true,
  precisaTrocarSenha: true, 
  criadoEm: true,
  atualizadoEm: true,
  deletadoEm: true,
} satisfies Prisma.UsuarioSelect

// ===== Auditoria helper =====
async function logAuditoria(
  prisma: PrismaClient,
  acao: string,
  alvo?: string,
  meta?: any,
  feitoPorId?: string,
) {
  try {
    await prisma.auditoria.create({
      data: { acao, alvo, meta, feitoPorId },
    })
  } catch {
    // Auditoria não derruba o fluxo principal
  }
}

type ServiceOpts = {
  feitoPorId?: string
  meta?: any
}

// ===== Create =====
export async function createUser(
  prisma: PrismaClient,
  data: UserCreateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const isAluno = !!data.ra

  const DEFAULT_TEMP_PASSWORD =
    process.env.DEFAULT_TEMP_PASSWORD || 'Mudar123#'

  // Senha padrão só pra satisfazer o NOT NULL no banco.
  // Ela nunca vai ser usada diretamente, porque o usuário vai criar a própria
  // via link mágico.
  const senhaPlano = DEFAULT_TEMP_PASSWORD
  const senhaHash = await hashPassword(senhaPlano)

  const created = await prisma.usuario.create({
    data: {
      nome: data.nome,
      emailPessoal: data.emailPessoal ?? data.emailEducacional,
      emailEducacional: data.emailEducacional ?? null,
      ra: data.ra ?? null,
      cursoNome: (data as any).cursoNome ?? null,
      cursoSigla: (data as any).cursoSigla ?? null,
      senhaHash,
      papel: (data.papel as any) ?? 'USUARIO',
      ativo: data.ativo ?? true,
      organizacaoId: data.organizacaoId ?? null,
      // Primeiro acesso SEMPRE exige troca de senha
      precisaTrocarSenha: true,
    },
    select: baseSelect,
  })

  // Dispara o link mágico de primeiro acesso
  await enviarLinkPrimeiroAcesso(prisma, {
    id: created.id,
    nome: created.nome,
    emailPessoal: created.emailPessoal,
    emailEducacional: created.emailEducacional,
  })

  await logAuditoria(
    prisma,
    'USUARIO_CRIADO',
    `usuarios:${created.id}`,
    {
      user: created,
      origem: opts?.meta?.origem ?? 'service:createUser',
      isAluno,
      metodoAcesso: 'MAGIC_LINK_FIRST_ACCESS',
    },
    opts?.feitoPorId,
  )

  return created as unknown as UserResponse
}


// ===== Get One (SEM filtrar deletadoEm) =====
export async function getUserById(
  prisma: PrismaClient,
  id: string,
): Promise<(UserResponse & { deletadoEm: Date | null }) | null> {
  const user = await prisma.usuario.findUnique({
    where: { id },
    select: baseSelect,
  })
  return user as any
}

// ===== List (paginated) =====
export async function listUsers(
  prisma: PrismaClient,
  q: UserListQuery,
): Promise<Paginated<UserResponse>> {
  const where: Prisma.UsuarioWhereInput = {
    deletadoEm: null, // não listar soft-deletados
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
            { cursoNome: { contains: q.q } },  // 👈 ajuda na busca
            { cursoSigla: { contains: q.q } }, // 👈 ajuda na busca
          ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.usuario.findMany({
      where,
      select: baseSelect,
      orderBy: { criadoEm: 'desc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
    }),
    prisma.usuario.count({ where }),
  ])

  return {
    items: items as any,
    page: q.page,
    perPage: q.perPage,
    total,
    pages: Math.ceil(total / q.perPage),
  }
}

// ===== Update =====
export async function updateUser(
  prisma: PrismaClient,
  id: string,
  data: UserUpdateDTO,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const patch: Prisma.UsuarioUncheckedUpdateInput = {
    nome: data.nome ?? undefined,
    emailPessoal: data.emailPessoal ?? undefined,
    emailEducacional: data.emailEducacional ?? undefined,
    ra: data.ra ?? undefined,
    cursoNome: (data as any).cursoNome ?? undefined,   // 👈 novo
    cursoSigla: (data as any).cursoSigla ?? undefined, // 👈 novo
    papel: (data.papel as any) ?? undefined,
    ativo: typeof data.ativo === 'boolean' ? data.ativo : undefined,
    anonimizado: typeof data.anonimizado === 'boolean' ? data.anonimizado : undefined,
    precisaTrocarSenha: (data as any).precisaTrocarSenha ?? undefined, // 👈 se quiser permitir alterar
  }

  // 3 estados p/ organizacaoId
  if ('organizacaoId' in data) {
    ;(patch as Prisma.UsuarioUncheckedUpdateInput).organizacaoId = data.organizacaoId as any
  }
  
  if ((data as any).senha) {
    patch.senhaHash = await hashPassword((data as any).senha)
  }

  const before = await prisma.usuario.findUnique({ where: { id }, select: baseSelect })

  const updated = await prisma.usuario.update({
    where: { id },
    data: patch,
    select: baseSelect,
  })

  await logAuditoria(
    prisma,
    'USUARIO_ATUALIZADO',
    `usuarios:${id}`,
    { changes: Object.keys(patch), before, after: updated, origem: opts?.meta?.origem ?? 'service:updateUser' },
    opts?.feitoPorId,
  )

  return updated as any
}

// ===== Soft Delete com anonimização por papel (RA preservado) =====
export async function softDeleteUser(
  prisma: PrismaClient,
  id: string,
  opts?: ServiceOpts,
): Promise<UserResponse> {
  const before = await prisma.usuario.findUnique({
    where: { id },
    select: baseSelect,
  })
  if (!before) {
    const err: any = new Error('Usuário não encontrado')
    err.code = 'P2025'
    throw err
  }

  const isAluno = before.papel === 'USUARIO'

  // domínios configuráveis
  const anonDomain = process.env.ANON_EMAIL_DOMAIN || 'anon.local'
  const anonEduDomain = process.env.ANON_EDU_DOMAIN || 'anon.edu.local'

  // e-mails únicos e válidos usando o próprio id
  const anonEmailPessoal = `anonp_${id}@${anonDomain}`
  const anonEmailEduc = `anone_${id}@${anonEduDomain}`

  const dataUpdate: Prisma.UsuarioUncheckedUpdateInput = {
    deletadoEm: new Date(),
    ativo: false,
    anonimizado: true,
    nome: 'Usuário Anônimo',
    // ⚠️ RA preservado
    ra: before.ra,
    // organizacaoId: null, // opcional: desassociar se quiser
  }

  if (isAluno) {
    dataUpdate.emailEducacional = anonEmailEduc
    dataUpdate.emailPessoal = anonEmailPessoal
  } else {
    dataUpdate.emailPessoal = anonEmailPessoal
    dataUpdate.emailEducacional = null
  }

  const deleted = await prisma.usuario.update({
    where: { id },
    data: dataUpdate,
    select: baseSelect,
  })

  await logAuditoria(
    prisma,
    'USUARIO_REMOVIDO_SOFT',
    `usuarios:${id}`,
    { before, after: deleted, origem: opts?.meta?.origem ?? 'service:softDeleteUser' },
    opts?.feitoPorId,
  )

  return deleted as any
}
