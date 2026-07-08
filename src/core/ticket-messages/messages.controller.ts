import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import {
  CreateMessageSchema,
  ListMessagesSchema,
} from "./messages.types";
import {
  createTicketMessage,
  listTicketMessages,
} from "./messages.service";
import { getTicketOwnerId } from "../tickets/tickets.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Alunos (papel USUARIO) só podem ler/escrever mensagens dos próprios chamados.
 * Retorna true quando o acesso deve ser negado (chamado inexistente ou de outro
 * aluno); false quando liberado.
 */
async function alunoSemAcessoAoChamado(
  prisma: any,
  chamadoId: string,
  authUser: { sub: string; role: string } | undefined,
): Promise<boolean> {
  if (!authUser || authUser.role !== "USUARIO") return false;
  const donoId = await getTicketOwnerId(prisma, chamadoId);
  return donoId !== authUser.sub;
}

const createValidator = buildRouteValidator({
  params: CreateMessageSchema.shape.params,
  body: CreateMessageSchema.shape.body,
});
const listValidator = buildRouteValidator({
  params: ListMessagesSchema.shape.params,
  query: ListMessagesSchema.shape.query,
});

/* POST /tickets/:id/mensagens */
export async function create(req: FastifyRequest, res: FastifyReply) {
  const parsed = createValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const authUser = (req as any).user as { sub: string; role: string } | undefined;
  const userId = authUser?.sub;
  if (!userId) return void (await res.code(401).send({ error: "Não autenticado" }));

  try {
    const { id } = parsed.data!.params!;
    const { conteudo } = parsed.data!.body!;

    if (await alunoSemAcessoAoChamado(prisma, id, authUser))
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    const created = await createTicketMessage(prisma, id, userId, conteudo);
    await res.code(201).send(created);
  } catch (e: any) {
    if (e?.code === "P2025")
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));
    req.log.error({ e }, "💥 Erro ao criar mensagem do chamado");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /tickets/:id/mensagens */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const authUser = (req as any).user as { sub: string; role: string } | undefined;

  try {
    const { id } = parsed.data!.params!;
    const q = parsed.data!.query!;

    if (await alunoSemAcessoAoChamado(prisma, id, authUser))
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));

    const page = await listTicketMessages(prisma, id, q);
    await res.send(page);
  } catch (e: any) {
    if (e?.code === "P2025")
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));
    req.log.error({ e }, "💥 Erro ao listar mensagens do chamado");
    await res.code(500).send({ error: errMsg(e) });
  }
}
