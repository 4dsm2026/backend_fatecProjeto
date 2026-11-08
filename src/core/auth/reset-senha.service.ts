import { createHash, randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../security/password";
import { getMailDriver } from "../../config/mail";
import { ApiError } from "../../hateoas";
import { FINALIDADE_PRIMEIRO_ACESSO, FINALIDADE_RESET_SENHA } from "./token-finalidade";

const APP_WEB_URL = process.env.APP_WEB_URL!;

/**
 * Gera token bruto + hash.
 */
function gerarToken() {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Envia link de PRIMEIRO ACESSO.
 * Usa a tabela TokenResetSenha, com finalidade PRIMEIRO_ACESSO (não vale como reset).
 */
export async function enviarLinkPrimeiroAcesso(
  prisma: PrismaClient,
  usuario: {
    id: string;
    nome: string | null;
    emailPessoal: string | null;
    emailEducacional: string | null;
  },
) {
  const email = usuario.emailPessoal ?? usuario.emailEducacional;
  if (!email) return;

  const { token, tokenHash } = gerarToken();
  const expiraEm = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 horas

  await prisma.tokenResetSenha.create({
    data: {
      usuarioId: usuario.id,
      tokenHash,
      finalidade: FINALIDADE_PRIMEIRO_ACESSO,
      expiraEm,
    },
  });

  const link = `${APP_WEB_URL}/primeiro-acesso?token=${token}`;

  await getMailDriver().send({
    to: email,
    subject: "Ative seu acesso e defina sua senha",
    html: `
      <p>Olá ${usuario.nome ?? ""},</p>
      <p>Seu acesso ao Workflow Fatec foi criado.</p>
      <p>Clique no link abaixo para definir sua senha (válido por 24h):</p>
      <p><a href="${link}">Definir senha</a></p>
      <p>Se você não reconhece este acesso, pode ignorar este e-mail.</p>
    `,
  });
}

export async function enviarLinkEsqueciSenha(
  prisma: PrismaClient,
  email: string,
) {
  const usuario = await prisma.usuario.findFirst({
    where: {
      OR: [
        { emailPessoal: email },
        { emailEducacional: email },
      ],
      deletadoEm: null,
      ativo: true,
    },
    select: {
      id: true,
      nome: true,
      emailPessoal: true,
      emailEducacional: true,
    },
  });

  // Por segurança, não revelar se não existe
  if (!usuario) return;

  const { token, tokenHash } = gerarToken();
  const expiraEm = new Date(Date.now() + 1000 * 60 * 60 * 1); // 1 hora

  await prisma.tokenResetSenha.create({
    data: {
      usuarioId: usuario.id,
      tokenHash,
      finalidade: FINALIDADE_RESET_SENHA,
      expiraEm,
    },
  });

  const link = `${APP_WEB_URL}/reset-senha?token=${token}`;

  await getMailDriver().send({
    to: email,
    subject: "Redefinição de senha — Workflow Fatec",
    html: `
      <p>Olá ${usuario.nome ?? ""},</p>
      <p>Recebemos um pedido para redefinir sua senha.</p>
      <p>Clique no link abaixo para continuar (válido por 1 hora):</p>
      <p><a href="${link}">Redefinir minha senha</a></p>
      <p>Se você não pediu isso, apenas ignore este e-mail.</p>
    `,
  });
}

/**
 * Redefine a senha a partir de um token de RESET_SENHA (`PUT /password-resets/:token`).
 *
 * Erros (D-R2): token inexistente, expirado, de outra finalidade ou de conta
 * inativa/apagada = `404` (indistinguíveis de propósito); token já usado = `409`.
 *
 * O token é consumido com `updateMany ... usadoEm: null` DENTRO da transação e o
 * resultado é conferido: duas requisições simultâneas com o mesmo token não
 * passam as duas. Os OUTROS tokens de reset pendentes do usuário também são
 * invalidados. Encerra TODAS as sessões do usuário. A senha já chega validada
 * (zStrongPassword, aparada) pelo schema da rota.
 */
export async function redefinirSenhaPorToken(prisma: PrismaClient, tokenRaw: string, novaSenha: string) {
  const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
  const agora = new Date();

  const token = await prisma.tokenResetSenha.findFirst({
    where: { tokenHash, finalidade: FINALIDADE_RESET_SENHA },
    include: {
      usuario: {
        select: { id: true, nome: true, emailPessoal: true, emailEducacional: true, ativo: true, deletadoEm: true },
      },
    },
  });

  if (!token || token.expiraEm <= agora || !token.usuario.ativo || token.usuario.deletadoEm) {
    throw new ApiError("not-found", "Token inválido ou expirado");
  }
  if (token.usadoEm) {
    throw new ApiError("conflict", "Token já utilizado");
  }

  const senhaHash = await hashPassword(novaSenha);

  await prisma.$transaction(async (tx) => {
    const consumido = await tx.tokenResetSenha.updateMany({
      where: { id: token.id, usadoEm: null, expiraEm: { gt: agora } },
      data: { usadoEm: agora },
    });
    if (consumido.count !== 1) {
      throw new ApiError("conflict", "Token já utilizado");
    }
    // Quem pediu o link mais de uma vez tem vários tokens válidos: usar um encerra todos.
    await tx.tokenResetSenha.updateMany({
      where: { usuarioId: token.usuarioId, finalidade: FINALIDADE_RESET_SENHA, usadoEm: null },
      data: { usadoEm: agora },
    });
    await tx.usuario.update({
      where: { id: token.usuarioId },
      data: { senhaHash, precisaTrocarSenha: false, passwordUpdatedAt: agora },
    });
    await tx.sessao.updateMany({
      where: { usuarioId: token.usuarioId, revogadaEm: null },
      data: { revogadaEm: agora },
    });
  });

  const { id, nome, emailPessoal, emailEducacional } = token.usuario;
  return { id, nome, emailPessoal, emailEducacional };
}
