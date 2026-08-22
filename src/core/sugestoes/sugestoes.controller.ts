import { FastifyRequest, FastifyReply } from 'fastify'
import { buildRouteValidator } from '../../utils/zod-helpers'
import { SugestaoCreateSchema, SugestaoListSchema } from '../../validators/sugestoes'
import { createSugestao, listMinhasSugestoes } from './sugestoes.service'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const createValidator = buildRouteValidator({ body: SugestaoCreateSchema.shape.body })
const listValidator = buildRouteValidator({ query: SugestaoListSchema.shape.query })

/* ============ POST /sugestoes ============ */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  const usuarioId = req.user?.sub as string | undefined

  try {
    if (!usuarioId) return void (await res.code(401).send({ error: 'Não autenticado' }))

    const sugestao = await createSugestao(prisma, parsed.data!.body!, { usuarioId })
    await res.code(201).send(sugestao)
  } catch (e) {
    req.log.error({ e }, '💥 Erro ao criar sugestão')
    await res.code(500).send({ error: errMsg(e) })
  }
}

/* ============ GET /sugestoes (do próprio usuário) ============ */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req)
  if ('error' in parsed) return void (await res.code(400).send(parsed.error))

  const prisma = req.server.prisma
  const usuarioId = req.user?.sub as string | undefined

  try {
    if (!usuarioId) return void (await res.code(401).send({ error: 'Não autenticado' }))

    const result = await listMinhasSugestoes(prisma, usuarioId, parsed.data!.query!)
    await res.send(result)
  } catch (e) {
    req.log.error({ e }, '💥 Erro ao listar sugestões')
    await res.code(500).send({ error: errMsg(e) })
  }
}
