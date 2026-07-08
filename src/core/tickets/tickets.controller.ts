import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import {
  TicketCreateSchema,
  TicketListSchema,
  TicketUpdateSchema,
  ParamsWithIdSchema,
} from "../../validators/tickets";
import {
  createTicket,
  getTicketById,
  getTicketOwnerId,
  listTickets,
  updateTicket,
  softDeleteTicket,
  statsTickets,
} from "./tickets.service";
import type { TicketsListQuery } from "./tickets.types";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Alunos (papel USUARIO) só podem acessar os próprios chamados. Retorna true
 * quando o acesso deve ser negado. Para papéis de equipe, nunca nega.
 * Retorna null quando o chamado não existe (o chamador devolve 404).
 */
async function alunoSemAcessoAoChamado(
  prisma: any,
  chamadoId: string,
  authUser: { sub: string; role: string } | undefined,
): Promise<boolean | null> {
  if (!authUser || authUser.role !== "USUARIO") return false;
  const donoId = await getTicketOwnerId(prisma, chamadoId);
  if (donoId === null) return null;
  return donoId !== authUser.sub;
}

const createValidator = buildRouteValidator({ body: TicketCreateSchema.shape.body });
const listValidator   = buildRouteValidator({ query: TicketListSchema.shape.query });
const idValidator     = buildRouteValidator({ params: ParamsWithIdSchema.shape.params });
const updateValidator = buildRouteValidator({
  params: TicketUpdateSchema.shape.params,
  body:   TicketUpdateSchema.shape.body,
});

/* ============ POST /tickets ============ */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const feitoPorId = (req as any).user?.sub as string | undefined;

  try {
    if (!feitoPorId)
      return void (await res.code(401).send({ error: "Não autenticado" }));

    const ticket = await createTicket(prisma, parsed.data!.body!, { feitoPorId });
    await res.code(201).send(ticket);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao criar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ GET /tickets/:id ============ */
export async function getOne(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const authUser = (req as any).user as { sub: string; role: string } | undefined;
  try {
    const id = parsed.data!.params!.id;

    const semAcesso = await alunoSemAcessoAoChamado(prisma, id, authUser);
    // Chamado inexistente ou de outro aluno: mesma resposta 404 (não vaza existência).
    if (semAcesso !== false)
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    const ticket = await getTicketById(prisma, id, [
      "cliente", "contrato", "servico", "setor", "responsavel", "criadoPor", "historico",
    ]);

    if (!ticket)
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    await res.send(ticket);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao buscar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ GET /tickets ============ */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const authUser = (req as any).user as { sub: string; role: string } | undefined;

  if (!authUser)
    return void (await res.code(401).send({ error: "Não autenticado" }));

  try {
    const q = parsed.data!.query!;
    const isAluno = authUser.role === "USUARIO";

    const query: TicketsListQuery = {
      ...q,
      criadoPorId: isAluno ? authUser.sub : q.criadoPorId,
    };

    await res.send(await listTickets(prisma, query));
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar tickets");
    await res.code(500).send({ error: "Erro interno ao listar tickets" });
  }
}

/* ============ GET /tickets/stats ============ */
export async function stats(req: FastifyRequest, res: FastifyReply) {
  const prisma   = (req.server as any).prisma;
  const authUser = (req as any).user as { sub: string; role: string } | undefined;

  if (!authUser)
    return void (await res.code(401).send({ error: "Não autenticado" }));

  try {
    const organizacaoId = (req.query as any)?.organizacaoId as string | undefined;
    const result = await statsTickets(prisma, { organizacaoId });
    await res.send(result);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao computar stats de tickets");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ PATCH /tickets/:id ============ */
export async function patch(req: FastifyRequest, res: FastifyReply) {
  const parsed = updateValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma     = (req.server as any).prisma;
  const authUser   = (req as any).user as { sub: string; role: string } | undefined;
  const feitoPorId = authUser?.sub;

  try {
    const id = parsed.data!.params!.id;

    const semAcesso = await alunoSemAcessoAoChamado(prisma, id, authUser);
    if (semAcesso !== false)
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    const ticket = await updateTicket(
      prisma,
      id,
      parsed.data!.body!,
      { feitoPorId },
    );
    await res.send(ticket);
  } catch (e: any) {
    if (e?.code === "P2025")
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));
    req.log.error({ e }, "💥 Erro ao atualizar ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* ============ DELETE /tickets/:id (soft) ============ */
export async function removeSoft(req: FastifyRequest, res: FastifyReply) {
  const parsed = idValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma     = (req.server as any).prisma;
  const authUser   = (req as any).user as { sub: string; role: string } | undefined;
  const feitoPorId = authUser?.sub;

  try {
    const id = parsed.data!.params!.id;

    const semAcesso = await alunoSemAcessoAoChamado(prisma, id, authUser);
    if (semAcesso !== false)
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    const ticket = await softDeleteTicket(
      prisma,
      id,
      { feitoPorId },
    );
    await res.send(ticket);
  } catch (e: any) {
    if (e?.code === "P2025")
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));
    req.log.error({ e }, "💥 Erro ao remover (soft) ticket");
    await res.code(500).send({ error: errMsg(e) });
  }
}
