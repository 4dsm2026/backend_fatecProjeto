import type { FastifyReply, FastifyRequest } from "fastify";
import { parseOrThrow } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { AccountActivationParamsSchema, AtivarContaBodySchema } from "../../validators/auth";
import { ativarContaPorToken } from "../auth/ativacao-conta.service";

/**
 * `PUT /account-activations/:token`: conclui o primeiro acesso.
 * `204` sem corpo e sem sessão (D-R1): o login acontece em `POST /sessions`.
 */
export const putAccountActivation = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const { token } = parseOrThrow(AccountActivationParamsSchema, req.params);
  const { novaSenha, emailPessoal } = parseOrThrow(AtivarContaBodySchema, req.body);

  const user = await ativarContaPorToken(req.server.prisma, token, { novaSenha, emailPessoal });

  await registrarAuditoria({ feitoPorId: user.id, acao: "primeiro_acesso_sucesso", alvo: user.id, meta: {} });

  await res.code(204).send();
};
