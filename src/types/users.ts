// types/users.ts
import { z } from 'zod'
import {
  UserCreateSchema,
  UserUpdateSchema,
  PapelEnum,
} from '../validators/users'
import type { UsersListQuery, UserPublic } from '../core/users/users.types'

// ====== Tipos derivados dos schemas ======
export type UserCreateDTO = z.infer<typeof UserCreateSchema>['body']
export type UserUpdateDTO = z.infer<typeof UserUpdateSchema>['body']
export type UserListQuery = UsersListQuery

// ====== Enum literal (reutilizável) ======
export type PapelUsuario = z.infer<typeof PapelEnum>

// ====== Tipo de resposta do usuário ======
export type UserResponse = UserPublic
