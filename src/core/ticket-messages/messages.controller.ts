import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { sendReply } from "../../utils/http";
import {
  CreateMessageSchema,
  ListMessagesSchema,
} from "./messages.types";
import {
  createTicketMessage,
  listTicketMessages,
} from "./messages.service";
import { alunoSemAcessoAoChamado } from "../tickets/tickets.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  if ("error" in parsed) return sendReply(res, 400, parsed.error);

  const prisma = req.server.prisma;
  const authUser = req.user as { sub: string; role: string } | undefined;
  const userId = authUser?.sub;
  if (!userId) return sendReply(res, 401, { error: "Não autenticado" });

  try {
    const { id } = parsed.data!.params!;
    const { conteudo } = parsed.data!.body!;

    if (await alunoSemAcessoAoChamado(prisma, id, authUser))
      return sendReply(res, 404, { error: "Chamado não encontrado" });

    const created = await createTicketMessage(prisma, id, userId, conteudo);
    await res.code(201).send(created);
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendReply(res, 404, { error: "Chamado não encontrado" });
    req.log.error({ e }, "💥 Erro ao criar mensagem do chamado");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* GET /tickets/:id/mensagens */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const parsed = listValidator.parse(req);
  if ("error" in parsed) return sendReply(res, 400, parsed.error);

  const prisma = req.server.prisma;
  const authUser = req.user as { sub: string; role: string } | undefined;

  try {
    const { id } = parsed.data!.params!;
    const q = parsed.data!.query!;

    if (await alunoSemAcessoAoChamado(prisma, id, authUser))
      return sendReply(res, 404, { error: "Chamado não encontrado" });

    const page = await listTicketMessages(prisma, id, q);
    await res.send(page);
  } catch (e: any) {
    if (e?.code === "P2025")
      return sendReply(res, 404, { error: "Chamado não encontrado" });
    req.log.error({ e }, "💥 Erro ao listar mensagens do chamado");
    await res.code(500).send({ error: errMsg(e) });
  }
}
