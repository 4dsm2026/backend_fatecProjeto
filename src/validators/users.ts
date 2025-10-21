import { z } from 'zod'


export const PapelEnum = z.enum(['USUARIO','BACKOFFICE','TECNICO','ADMINISTRADOR'])


export const UserCreateSchema = z.object({
body: z.object({
organizacaoId: z.string().cuid().optional().nullable(),
nome: z.string().min(2).max(160),
emailPessoal: z.string().email(),
emailEducacional: z.string().email().optional().nullable(),
ra: z.string().max(32).optional().nullable(),
papel: PapelEnum.default('USUARIO'),
ativo: z.boolean().optional().default(true),
senha: z.string().min(8),
}),
})


export const UserUpdateSchema = z.object({
body: z.object({
organizacaoId: z.string().cuid().optional().nullable(),
nome: z.string().min(2).max(160).optional(),
emailPessoal: z.string().email().optional(),
emailEducacional: z.string().email().optional().nullable(),
ra: z.string().max(32).optional().nullable(),
papel: PapelEnum.optional(),
ativo: z.boolean().optional(),
anonimizado: z.boolean().optional(),
senha: z.string().min(8).optional(),
})
})


export const UserListSchema = z.object({
query: z.object({
page: z.coerce.number().int().gte(1).default(1),
perPage: z.coerce.number().int().min(1).max(100).default(20),
q: z.string().trim().min(1).optional(),
papel: PapelEnum.optional(),
organizacaoId: z.string().cuid().optional(),
ativo: z.union([z.literal('true'), z.literal('false')]).optional(),
})
})


export const ParamsWithIdSchema = z.object({
params: z.object({ id: z.string().cuid() })
})