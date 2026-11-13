import type {
  CreateSectorBindingInput,
  CreateSectorInput,
  CreatedHttpResource,
  SectorBindingResource,
  SectorResource,
  TestContext,
  TestSession,
} from '../_setup/contracts'

export type { SectorBindingResource, SectorResource }
export type Created<T extends { id: string }> = CreatedHttpResource<T>

async function create<T extends { id: string }>(ctx: TestContext, session: TestSession, path: string, body: object): Promise<Created<T>> {
  const response = await fetch(new URL(path, ctx.baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status !== 201) {
    throw new Error(`POST ${path}: esperado 201, recebido ${response.status}. ${await response.text()}`)
  }
  // Preserva o corpo da resposta para assertions dos testes chamadores.
  const resource = await response.clone().json() as T
  if (typeof resource?.id !== 'string' || !resource.id) throw new Error(`POST ${path}: resposta sem id válido`)
  return { resource, response }
}

/** Cria uma pré-condição pela API; a resposta original permanece disponível. */
export function createSetor(ctx: TestContext, session: TestSession, input: CreateSectorInput): Promise<Created<SectorResource>> {
  return create(ctx, session, '/admin/sectors', input)
}

/** Vincula por HTTP, usando a sessão fornecida pelo helper de autenticação. */
export function vincularUsuarioAoSetor(ctx: TestContext, session: TestSession, input: CreateSectorBindingInput): Promise<Created<SectorBindingResource>> {
  const { usuarioId, ...body } = input
  return create(ctx, session, `/admin/users/${encodeURIComponent(usuarioId)}/sectors`, body)
}
