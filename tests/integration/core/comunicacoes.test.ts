import { describe, expect, it } from 'vitest'
import { createUser, loginAs } from '../_helpers/auth'
import { waitForEmail } from '../_helpers/mailbox'
import { createTestApp } from '../_setup/createTestApp'

describe('Integração: comunicações', () => {
  it('admin cria e atualiza modelo e envia e-mail capturado', async () => {
    const ctx = await createTestApp()
    const admin = await loginAs(ctx, await createUser(ctx, 'ADMINISTRADOR'))
    const student = await loginAs(ctx, await createUser(ctx, 'USUARIO'))
    const request = (path: string, method: string, body: object, token: string) => fetch(new URL(path, ctx.baseUrl), {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const template = { nome: 'Aviso de teste', assunto: 'Aviso {{aluno.nome}}', corpo: '<p>Olá {{aluno.nome}}</p>', habilitado: true }
    const forbidden = await request('/admin/communication-templates/teste', 'PUT', template, student.accessToken)
    expect(forbidden.status).toBe(403)
    const created = await request('/admin/communication-templates/teste', 'PUT', template, admin.accessToken)
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toBe('/admin/communication-templates/teste')
    const updated = await request('/admin/communication-templates/teste', 'PUT', { ...template, nome: 'Aviso atualizado' }, admin.accessToken)
    expect(updated.status).toBe(200)
    expect((await updated.json()).nome).toBe('Aviso atualizado')
    const sent = await request('/admin/communication-tests', 'POST', { to: student.actor.email, assunto: template.assunto, corpo: template.corpo }, admin.accessToken)
    expect(sent.status).toBe(200)
    const message = await waitForEmail(student.actor.email, '[TESTE]')
    expect(message.html).toContain('Olá')
    expect(message.html).not.toContain('{{aluno.nome}}')
  })
})
