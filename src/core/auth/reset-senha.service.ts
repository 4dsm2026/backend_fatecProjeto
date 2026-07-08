import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../security/password";
import { getMailDriver } from "../../config/mail";

const APP_WEB_URL = process.env.APP_WEB_URL!;


export function validarPoliticaSenha(senha: string): boolean {
  return (
    senha.length >= 8 &&
    /[A-Z]/.test(senha) &&
    /[a-z]/.test(senha) &&
    /\d/.test(senha) &&
    /[^A-Za-z0-9]/.test(senha)
  );
}

/**
 * Gera token bruto + hash.
 */
function gerarToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Envia link de PRIMEIRO ACESSO.
 * Usa o TokenResetSenha (mesma tabela do reset normal).
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


export async function consumirTokenSenha(
  prisma: PrismaClient,
  tokenRaw: string,
  novaSenha: string,
) {
  if (!validarPoliticaSenha(novaSenha)) {
    const err: any = new Error("Senha não atende aos critérios mínimos.");
    err.statusCode = 400;
    throw err;
  }

  const tokenHash = crypto.createHash("sha256").update(tokenRaw).digest("hex");

  const token = await prisma.tokenResetSenha.findFirst({
    where: {
      tokenHash,
      usadoEm: null,
      expiraEm: { gt: new Date() },
    },
  });

  if (!token) {
    const err: any = new Error("Token inválido ou expirado.");
    err.statusCode = 400;
    throw err;
  }

  const senhaHash = await hashPassword(novaSenha);

  await prisma.$transaction([
    prisma.usuario.update({
      where: { id: token.usuarioId },
      data: {
        senhaHash,
        precisaTrocarSenha: false,
        passwordUpdatedAt: new Date(),
      },
    }),
    prisma.tokenResetSenha.update({
      where: { id: token.id },
      data: { usadoEm: new Date() },
    }),
    // Redefinir a senha deve encerrar as sessões antigas (consistente com
    // POST /auth/trocar-senha), impedindo que um refresh anterior siga válido.
    prisma.sessao.updateMany({
      where: { usuarioId: token.usuarioId, revogadaEm: null },
      data: { revogadaEm: new Date() },
    }),
  ]);

  const user = await prisma.usuario.findUnique({
    where: { id: token.usuarioId },
    select: {
      id: true,
      nome: true,
      ra: true,
      papel: true,
    },
  });

  return user;
}
