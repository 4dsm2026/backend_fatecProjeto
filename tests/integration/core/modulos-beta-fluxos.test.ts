import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { createTestApp } from '../_setup/createTestApp'

describe('Integração: operações dos módulos beta', () => {
  it.each([
    {
      path: '/school-passes',
      body: { modalidade: 'MEIA_TARIFA', nomeCompleto: 'Aluno Exemplo', rg: '123456789', cpf: '52998224725', cep: '01001000', municipioResidencia: 'São Paulo', curso: 'DSM', periodo: 'Noite', mesConclusao: 12, anoConclusao: 2028 },
    },
    { path: '/enrollment-requests', body: { tipo: 'TRANCAMENTO', motivo: 'FINANCEIRO' } },
  ])('$path cria pedido, impede duplicidade e protege consulta de outro aluno', async ({ path, body }) => {
    const ctx = await createTestApp()
    const owner = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const other = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const headers = { authorization: `Bearer ${owner.accessToken}`, 'content-type': 'application/json' }
    const create = () => fetch(new URL(path, ctx.baseUrl), { method: 'POST', headers, body: JSON.stringify(body) })
    const created = await create()
    expect(created.status).toBe(201)
    const resource = await created.json() as { id: string; status: string }
    expect(resource.status).toBe('SOLICITADO')
    const duplicate = await create()
    expect(duplicate.status).toBe(409)
    const hidden = await fetch(new URL(`${path}/${resource.id}`, ctx.baseUrl), { headers: { authorization: `Bearer ${other.accessToken}` } })
    expect(hidden.status).toBe(404)
    const visible = await fetch(new URL(`${path}/${resource.id}`, ctx.baseUrl), { headers })
    expect(visible.status).toBe(200)
  })

  it('restringe a criação e consulta de pesquisa em rascunho', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const student = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const body = JSON.stringify({ titulo: 'Avaliação institucional', semestre: '2026-2', modelo: false })
    const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
    const forbidden = await fetch(new URL('/surveys', ctx.baseUrl), { method: 'POST', headers: headers(student.accessToken), body })
    expect(forbidden.status).toBe(403)
    const created = await fetch(new URL('/surveys', ctx.baseUrl), { method: 'POST', headers: headers(admin.accessToken), body })
    expect(created.status).toBe(201)
    const resource = await created.json() as { id: string; status: string }
    expect(resource.status).toBe('RASCUNHO')
    const hidden = await fetch(new URL(`/surveys/${resource.id}`, ctx.baseUrl), { headers: headers(student.accessToken) })
    expect(hidden.status).toBe(404)
    const visible = await fetch(new URL(`/surveys/${resource.id}`, ctx.baseUrl), { headers: headers(admin.accessToken) })
    expect(visible.status).toBe(200)
  })
})
