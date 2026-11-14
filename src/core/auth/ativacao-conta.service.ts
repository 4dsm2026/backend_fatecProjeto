import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../../hateoas";
import { hashPassword } from "../../security/password";
import { FINALIDADE_PRIMEIRO_ACESSO } from "./token-finalidade";

/**
 * Conclui o primeiro acesso (`PUT /account-activations/:token`): define a senha e,
 * se vier, o e-mail pessoal.
 *
 * Erros (D-R2): token inexistente, expirado, de outra finalidade, de conta apagada
 * ou de conta que já não precisa trocar a senha = `404` (indistinguíveis); token
 * já usado = `409`; conta inativa = `403`; e-mail pessoal de outra conta = `409` com
 * `type: /errors/email-already-in-use`.
 *
 * O token é consumido com `updateMany ... usadoEm: null` DENTRO da transação e o
 * resultado é conferido (uma corrida não passa duas vezes). Ao concluir, os OUTROS
 * tokens de primeiro acesso pendentes do usuário são invalidados: cada tentativa de
 * login emite um, e nenhum deles pode sobreviver à conta já ativada. Não cria sessão.
 */
export async function ativarContaPorToken(
  prisma: PrismaClient,
  tokenRaw: string,
  dados: { novaSenha: string; emailPessoal?: string },
) {
  const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
  const agora = new Date();

  const token = await prisma.tokenResetSenha.findFirst({
    where: { tokenHash, finalidade: FINALIDADE_PRIMEIRO_ACESSO },
    include: {
      usuario: {
        select: { id: true, ativo: true, deletadoEm: true, precisaTrocarSenha: true },
      },
    },
  });

  if (!token || token.expiraEm <= agora || token.usuario.deletadoEm || !token.usuario.precisaTrocarSenha) {
    throw new ApiError("not-found", "Token inválido ou expirado");
  }
  if (token.usadoEm) {
    throw new ApiError("conflict", "Token já utilizado");
  }
  if (!token.usuario.ativo) {
    throw new ApiError("forbidden", "Usuário inativo");
  }

  const { emailPessoal } = dados;
  if (emailPessoal) {
    const dono = await prisma.usuario.findUnique({ where: { emailPessoal }, select: { id: true } });
    if (dono && dono.id !== token.usuarioId) {
      // `type` próprio: o cliente distingue este 409 do "token já utilizado" sem ler texto.
      throw new ApiError("conflict", "Este e-mail pessoal já está em uso", undefined, undefined, {
        type: "/errors/email-already-in-use",
      });
    }
  }

  const senhaHash = await hashPassword(dados.novaSenha);

  await prisma.$transaction(async (tx) => {
    const consumido = await tx.tokenResetSenha.updateMany({
      where: { id: token.id, usadoEm: null, expiraEm: { gt: agora } },
      data: { usadoEm: agora },
    });
    if (consumido.count !== 1) {
      throw new ApiError("conflict", "Token já utilizado");
    }
    await tx.tokenResetSenha.updateMany({
      where: { usuarioId: token.usuarioId, finalidade: FINALIDADE_PRIMEIRO_ACESSO, usadoEm: null },
      data: { usadoEm: agora },
    });
    await tx.usuario.update({
      where: { id: token.usuarioId },
      data: {
        senhaHash,
        precisaTrocarSenha: false,
        passwordUpdatedAt: agora,
        ...(emailPessoal ? { emailPessoal } : {}),
      },
    });
  });

  return { id: token.usuarioId };
}
