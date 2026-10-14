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
  canUpdateUserFields,
  canUpdateUserTarget,
  hasProtectedAdminSelfUpdate,
  hasRestrictedUserUpdateField,
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
  const prisma = req.server.prisma
  const target = await getUserById(prisma, targetId)
  if (!target) {
    if (!isUserAdmin(viewer.role) && targetId !== viewer.id) {
      throw new ApiError('forbidden', 'Acesso negado')
    }
    if (!isUserAdmin(viewer.role) && hasRestrictedUserUpdateField(Object.keys(body))) {
      throw new ApiError('forbidden', 'Um ou mais campos não são permitidos para este usuário')
    }
    throw new ApiError('not-found', 'Usuário não encontrado')
  }
  if (!canUpdateUserTarget(target, viewer)) {
    throw new ApiError('forbidden', 'Acesso negado')
  }
  if (target.deletadoEm !== null) {
    throw new ApiError('conflict', 'Usuário removido não pode ser atualizado')
  }
  if (hasProtectedAdminSelfUpdate(target, viewer, body)) {
    throw new ApiError('unprocessable', 'Não é permitido desativar, rebaixar ou anonimizar a própria conta de administrador')
  }
  if (!canUpdateUserFields(target, viewer, Object.keys(body))) {
    throw new ApiError('forbidden', 'Um ou mais campos não são permitidos para este usuário')
  }
  const user = await updateUser(prisma, targetId, body, { feitoPorId: viewer.id }, target)
  return reply.send(toResource(user, buildUserLinks(user, viewer)))
}

export async function removeSoft(req: FastifyRequest, reply: FastifyReply) {
  const { id } = parseOrThrow(ParamsWithIdSchema.shape.params, req.params)
  const viewer = requestViewer(req)
  const prisma = req.server.prisma
  const target = await getUserById(prisma, id)
  if (!target) throw new ApiError('not-found', 'Usuário não encontrado')
  if (target.deletadoEm !== null) throw new ApiError('conflict', 'Usuário já removido')
  if (isUserAdmin(viewer.role) && target.id === viewer.id && target.papel === 'ADMINISTRADOR') {
    throw new ApiError('unprocessable', 'Não é permitido remover a própria conta de administrador')
  }
  await softDeleteUser(prisma, id, { feitoPorId: viewer.id }, target)
  return reply.code(204).send()
}
