import { FastifyRequest, FastifyReply } from 'fastify'
import { buildRouteValidator } from '../../utils/zod-helpers'
import {
  UserCreateSchema,
  UserListSchema,
  UserUpdateSchema,
  ParamsWithIdSchema,
} from '../../validators/users'
import {
  createUser,
  getUserById,
  listUsers,
  softDeleteUser,
  updateUser,
} from './users.service'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const createValidator = buildRouteValidator({ body: UserCreateSchema.shape.body })
const listValidator = buildRouteValidator({ query: UserListSchema.shape.query })
const idValidator = buildRouteValidator({ params: ParamsWithIdSchema.shape.params })
const updateValidator = buildRouteValidator({
  params: ParamsWithIdSchema.shape.params,
  body: UserUpdateSchema.shape.body,
})

/* ============ POST /usuarios ============ */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  const feitoPorId = req.user?.sub as string | undefined

  try {
    const user = await createUser(prisma, parsed.data!.body!, { feitoPorId })
    await res.code(201).send(user)
  } catch (e: any) {
    if (e?.code === 'P2002' || e?.statusCode === 409) {
      const msg = String(e?.message || '').toLowerCase().includes('ra')
        ? 'RA já está em uso'
        : 'Email já está em uso'
      return void (await res.code(409).send({ error: msg }))
    }
    req.log.error({ e }, '💥 Erro ao criar usuário')
    await res.code(500).send({ error: errMsg(e) })
  }
}

/* ============ GET /usuarios/:id ============ */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  try {
    const user = await getUserById(prisma, parsed.data!.params!.id)
    if (!user) return void (await res.code(404).send({ error: 'Usuário não encontrado' }))
    await res.send(user)
  } catch (e) {
    req.log.error({ e }, '💥 Erro ao buscar usuário')
    await res.code(500).send({ error: errMsg(e) })
  }
}

/* ============ GET /usuarios ============ */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  try {
    const page = await listUsers(prisma, parsed.data!.query!)
    await res.send(page)
  } catch (e) {
    req.log.error({ e }, '💥 Erro ao listar usuários')
    await res.code(500).send({ error: errMsg(e) })
  }
}

/* ============ PATCH /usuarios/:id ============ */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const parsed = updateValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  const authUser = req.user as { sub: string; role: string } | undefined
  const feitoPorId = authUser?.sub
  const alvoId = parsed.data!.params!.id
  const body = parsed.data!.body! as Record<string, unknown>

  // Aluno (USUARIO) só pode editar o próprio cadastro e nunca campos
  // privilegiados — sem isso, um aluno poderia se promover a ADMINISTRADOR
  // ou reativar/desativar contas via PATCH /usuarios/:id.
  // 'senha' também é bloqueada: a troca de senha do próprio usuário passa por
  // POST /auth/trocar-senha, que exige a senha atual (reautenticação). O reset
  // por administrador via PATCH continua permitido para papéis de equipe.
  if (authUser?.role === 'USUARIO') {
    if (alvoId !== authUser.sub)
      return void (await res.code(403).send({ error: 'Acesso negado' }))
    for (const campo of ['papel', 'ativo', 'anonimizado', 'organizacaoId', 'senha']) {
      if (campo in body)
        return void (await res.code(403).send({ error: `Campo não permitido: ${campo}` }))
    }
  }

  try {
    const user = await updateUser(prisma, alvoId, body as any, {
      feitoPorId,
    })
    await res.send(user)
  } catch (e: any) {
    if (e?.code === 'P2025') return void (await res.code(404).send({ error: 'Usuário não encontrado' }))
    if (e?.code === 'P2002') return void (await res.code(409).send({ error: 'Duplicidade (email/RA)' }))
    req.log.error({ e }, '💥 Erro ao atualizar usuário')
    await res.code(500).send({ error: errMsg(e) })
  }
}

/* ============ DELETE /usuarios/:id (soft) ============ */
export async function removeSoft(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  const feitoPorId = req.user?.sub as string | undefined

  try {
    const user = await softDeleteUser(prisma, parsed.data!.params!.id, { feitoPorId })
    await res.send(user)
  } catch (e: any) {
    if (e?.code === 'P2025') return void (await res.code(404).send({ error: 'Usuário não encontrado' }))
    req.log.error({ e }, '💥 Erro ao remover (soft) usuário')
    await res.code(500).send({ error: errMsg(e) })
  }
}
