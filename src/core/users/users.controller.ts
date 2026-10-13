import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError, buildLinks, fieldErrorsFromZod, link, path, toCollection, toResource } from '../../hateoas'
import type { Viewer } from '../../hateoas'
import { z } from 'zod'
import {
  UserCreateSchema,
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
import {
  UsersListQuerySchema,
  buildUserLinks,
  isUserAdmin,
  isUserStaff,
  USER_AUTHENTICATED_ROLES,
} from './users.types'

function parseOrThrow<T extends z.ZodType<unknown>>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ApiError('bad-request', 'Dados inválidos', undefined, fieldErrorsFromZod(result.error.issues))
  }
  return result.data as z.output<T>
}

function requestViewer(req: FastifyRequest): Viewer {
  const user = req.user
  if (!user?.sub) throw new ApiError('unauthorized', 'Não autenticado')
  if (!USER_AUTHENTICATED_ROLES.includes(user.role as typeof USER_AUTHENTICATED_ROLES[number])) {
    throw new ApiError('forbidden', 'Papel de usuário inválido')
  }
  return { id: user.sub, role: user.role as Viewer['role'] }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const parsed = parseOrThrow(UserCreateSchema, { body: req.body })
  if (!parsed.body.nome) {
    throw new ApiError('bad-request', 'Dados inválidos', undefined, [
      { field: 'body.nome', message: 'Nome é obrigatório.' },
    ])
  }
  const viewer = requestViewer(req)
  const prisma = req.server.prisma
  const user = await createUser(prisma, parsed.body, { feitoPorId: viewer.id })
  const location = path`/users/${user.id}`
  return reply.header('Location', location).code(201).send(toResource(user, buildUserLinks(user, viewer)))
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(ParamsWithIdSchema.shape.params, req.params)
  const viewer = requestViewer(req)
  if (!isUserStaff(viewer.role) && id !== viewer.id) {
    throw new ApiError('forbidden', 'Acesso negado')
  }
  const prisma = req.server.prisma
  const user = await getUserById(prisma, id)
  if (!user) throw new ApiError('not-found', 'Usuário não encontrado')
  return reply.send(toResource(user, buildUserLinks(user, viewer)))
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = parseOrThrow(UsersListQuerySchema, req.query)
  const viewer = requestViewer(req)
  const prisma = req.server.prisma
  const result = await listUsers(prisma, query)
  const items = result.items.map((user) => toResource(user, buildUserLinks(user, viewer)))
  return reply.send(toCollection({
    rel: 'users',
    basePath: '/users',
    items,
    page: query.page,
    size: query.size,
    total: result.total,
    filters: { q: query.q },
    links: buildLinks({
      create: isUserAdmin(viewer.role) && link('/users', 'POST'),
    }),
  }))
}

export async function patch(req: FastifyRequest, reply: FastifyReply) {
  const params = parseOrThrow(ParamsWithIdSchema.shape.params, req.params)
  const body = parseOrThrow(UserUpdateSchema.shape.body, req.body)
  const viewer = requestViewer(req)
  const targetId = params.id
  if (!isUserStaff(viewer.role) && targetId !== viewer.id) {
    throw new ApiError('forbidden', 'Acesso negado')
  }
  if (body.papel !== undefined && viewer.role !== 'ADMINISTRADOR') {
    throw new ApiError('forbidden', 'Somente ADMINISTRADOR pode alterar o papel do usuário')
  }
  if (viewer.role === 'USUARIO') {
    const restrictedFields = ['papel', 'ativo', 'anonimizado', 'organizacaoId', 'senha'] as const
    const forbiddenField = restrictedFields.find((field) => field in body)
    if (forbiddenField) {
      throw new ApiError('forbidden', `Campo não permitido: ${forbiddenField}`)
    }
  }
  const prisma = req.server.prisma
  const user = await updateUser(prisma, targetId, body, { feitoPorId: viewer.id })
  return reply.send(toResource(user, buildUserLinks(user, viewer)))
}

export async function removeSoft(req: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(ParamsWithIdSchema.shape.params, req.params)
  const viewer = requestViewer(req)
  const prisma = req.server.prisma
  await softDeleteUser(prisma, id, { feitoPorId: viewer.id })
  return reply.code(204).send()
}
