import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { ComunicacaoUpsertSchema, ComunicacaoTesteSchema } from "./comunicacoes.types";
import { listTemplates, upsertTemplate, renderComAmostra } from "./comunicacoes.service";
import { getMailDriver } from "../../config/mail";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const upsertValidator = buildRouteValidator({
  params: ComunicacaoUpsertSchema.shape.params,
  body: ComunicacaoUpsertSchema.shape.body,
});
const testeValidator = buildRouteValidator({ body: ComunicacaoTesteSchema.shape.body });

/* GET /admin/comunicacoes */
export async function list(req: FastifyRequest, res: FastifyReply) {
  const prisma = (req.server as any).prisma;
  try {
    const data = await listTemplates(prisma);
    await res.send({ data });
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao listar templates de comunicação");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* PUT /admin/comunicacoes/:chave */
export async function upsert(req: FastifyRequest, res: FastifyReply) {
  const parsed = upsertValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const prisma = (req.server as any).prisma;
  try {
    const saved = await upsertTemplate(prisma, parsed.data!.params!.chave, parsed.data!.body!);
    await res.send(saved);
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao salvar template de comunicação");
    await res.code(500).send({ error: errMsg(e) });
  }
}

/* POST /admin/comunicacoes/teste */
export async function enviarTeste(req: FastifyRequest, res: FastifyReply) {
  const parsed = testeValidator.parse(req);
  if ("error" in parsed) return void (await res.code(400).send(parsed.error));
  const { to, assunto, corpo } = parsed.data!.body! as { to: string; assunto: string; corpo: string };
  try {
    await getMailDriver().send({
      to,
      subject: `[TESTE] ${renderComAmostra(assunto)}`,
      html: renderComAmostra(corpo),
    });
    await res.send({ message: `E-mail de teste enviado para ${to}` });
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao enviar e-mail de teste");
    await res.code(502).send({ error: `Falha ao enviar e-mail: ${errMsg(e)}` });
  }
}
