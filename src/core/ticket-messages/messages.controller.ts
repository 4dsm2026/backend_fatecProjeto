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
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));

  const prisma = (req.server as any).prisma;
  const userId = (req as any).user?.sub as string | undefined;
  if (!userId) return void (await res.code(401).send({ error: "Não autenticado" }));

  try {
    const { id } = parsed.data!.params!;
    const { conteudo } = parsed.data!.body!;
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

  try {
    const { id } = parsed.data!.params!;
    const q = parsed.data!.query!;
    const page = await listTicketMessages(prisma, id, q);
    await res.send(page);
  } catch (e: any) {
    if (e?.code === "P2025")
      return void (await res.code(404).send({ error: "Chamado não encontrado" }));
    req.log.error({ e }, "💥 Erro ao listar mensagens do chamado");
    await res.code(500).send({ error: errMsg(e) });
  }
}
