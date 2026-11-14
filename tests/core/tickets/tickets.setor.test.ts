/** Todo chamado aberto pelo catálogo recebe um setor (#114). */
import { vi, describe, it, expect } from 'vitest'

vi.mock('../../../src/lib/prisma')

import { resolverSetorDoChamado } from '../../../src/core/tickets/tickets.service'

type Ctx = Parameters<typeof resolverSetorDoChamado>[0]

const SETORES = [
  { id: 'setor_secretaria', nome: 'Secretaria' },
  { id: 'setor_suporte', nome: 'Suporte Técnico' },
]

/** Imita o findFirst/findMany do Prisma sobre uma lista de setores. */
function ctxCom(setores: { id: string; nome: string }[]) {
  const ordenados = [...setores].sort((a, b) => a.nome.localeCompare(b.nome))
  const ctx = {
    setor: {
      findFirst: vi.fn(async (args: { where?: { nome?: { contains: string } } }) => {
        const termo = args?.where?.nome?.contains
        return ordenados.find((s) => !termo || s.nome.includes(termo)) ?? null
      }),
      findMany: vi.fn(async () => ordenados),
    },
  }
  return ctx as unknown as Ctx
}

describe('resolverSetorDoChamado', () => {
  it('usa o setor com nome parecido com o setor provável', async () => {
    expect(await resolverSetorDoChamado(ctxCom(SETORES), 'Suporte')).toBe('setor_suporte')
    expect(await resolverSetorDoChamado(ctxCom(SETORES), 'Secretaria Acadêmica / Suporte SIGA')).toBe('setor_secretaria')
  })

  it.each(['Biblioteca', 'Coordenação de Curso', 'Acadêmico', null, undefined])(
    'sem setor parecido (%j) cai na Secretaria',
    async (provavel) => {
      expect(await resolverSetorDoChamado(ctxCom(SETORES), provavel)).toBe('setor_secretaria')
    },
  )

  it('sem Secretaria, usa o primeiro setor por nome', async () => {
    const setores = [{ id: 's2', nome: 'TI' }, { id: 's1', nome: 'Coordenação' }]
    expect(await resolverSetorDoChamado(ctxCom(setores), 'Biblioteca')).toBe('s1')
  })

  it('sem nenhum setor cadastrado, devolve null', async () => {
    expect(await resolverSetorDoChamado(ctxCom([]), 'Biblioteca')).toBeNull()
  })
})
