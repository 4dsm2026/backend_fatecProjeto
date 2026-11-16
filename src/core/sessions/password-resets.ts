import type { FastifyReply, FastifyRequest } from "fastify";
import { parseOrThrow, toResource } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { EsqueciSenhaSchema, PasswordResetParamsSchema, RedefinirSenhaBodySchema } from "../../validators/auth";
import { enviarLinkEsqueciSenha, redefinirSenhaPorToken } from "../auth/reset-senha.service";
import { enviarAvisoSenhaAlterada } from "../auth/senha-alterada.service";
import { buildPasswordResetRequestLinks } from "./sessions.links";

const MENSAGEM_PEDIDO = "Se existir uma conta com esse e-mail, enviaremos um link para redefinir a senha.";

/**
 * `POST /password-resets`: pede o link de redefinição.
 *
 * Resposta `202` idêntica e no mesmo tempo, exista a conta ou não: o envio roda
 * desacoplado e qualquer falha (e-mail, banco) só é logada. Nem o status nem a
 * demora revelam se o e-mail está cadastrado (S16).
 */
export const postPasswordReset = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const { email } = parseOrThrow(EsqueciSenhaSchema, req.body);

  void enviarLinkEsqueciSenha(req.server.prisma, email.trim().toLowerCase()).catch((err) => {
    req.log.error({ err }, "💥 Erro em password-resets (envio desacoplado)");
  });

  await res.code(202).send(toResource({ message: MENSAGEM_PEDIDO }, buildPasswordResetRequestLinks()));
};

/**
 * `PUT /password-resets/:token`: define a nova senha com o token recebido por e-mail.
 * `204` sem corpo: não devolve sessão (D-R1); o login acontece em `POST /sessions`.
 */
export const putPasswordReset = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const { token } = parseOrThrow(PasswordResetParamsSchema, req.params);
  const { novaSenha } = parseOrThrow(RedefinirSenhaBodySchema, req.body);

  const user = await redefinirSenhaPorToken(req.server.prisma, token, novaSenha);

  await registrarAuditoria({ feitoPorId: user.id, acao: "reset_senha_sucesso", alvo: user.id, meta: {} });

  void enviarAvisoSenhaAlterada({
    nome: user.nome,
    emailPessoal: user.emailPessoal,
    emailEducacional: user.emailEducacional,
    motivo: "reset",
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? ""),
  }).catch((err) => {
    req.log.error({ err }, "💥 Falha ao enviar aviso de senha alterada");
  });

  await res.code(204).send();
};
