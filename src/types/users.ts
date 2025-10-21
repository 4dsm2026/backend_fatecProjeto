// types/users.ts
import { z } from 'zod'
import {
  UserCreateSchema,
  UserUpdateSchema,
  UserListSchema,
  PapelEnum,
} from '../validators/users'

// ====== Tipos derivados dos schemas ======
export type UserCreateDTO = z.infer<typeof UserCreateSchema>['body']
export type UserUpdateDTO = z.infer<typeof UserUpdateSchema>['body']
export type UserListQuery = z.infer<typeof UserListSchema>['query']

// ====== Enum literal (reutilizável) ======
export type PapelUsuario = z.infer<typeof PapelEnum>

// ====== Tipo de resposta do usuário ======
export type UserResponse = {
  id: string
  organizacaoId: string | null
  nome: string
  emailPessoal: string
  emailEducacional: string | null
  ra: string | null
  papel: PapelUsuario
  ativo: boolean
  anonimizado: boolean
  criadoEm: string | Date
  atualizadoEm: string | Date
}

// ====== Paginação genérica ======
export type Paginated<T> = {
  items: T[]
  page: number
  perPage: number
  total: number
  pages: number
}
