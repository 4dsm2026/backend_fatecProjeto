// src/modules/auth/auth.service.ts
import argon2 from "argon2";
import { generateAccessToken, generateRefreshToken } from "../../utils/jwt";
import { hashValue } from "../../utils/crypto";
import { prisma } from "../../db/prisma";

type LoginContext = {
  ip?: string | null;
  userAgent?: string | null;
};

const REFRESH_TTL_DAYS = 7;
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos

function plusMs(ms: number) {
  return new Date(Date.now() + ms);
}

const checkAccountLock = async (user: any) => {
  if (!user.lockedUntil) return false;

  if (user.lockedUntil < new Date()) {
    await prisma.usuario.update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastFailedAttempt: null,
      },
    });
    return false;
  }

  return true;
};

const recordFailedAttempt = async (
  userId: string,
  email: string,
  ctx: LoginContext,
  motivo = "Senha incorreta"
) => {
  const updatedUser = await prisma.usuario.update({
    where: { id: userId },
    data: {
      loginAttempts: { increment: 1 },
      lastFailedAttempt: new Date(),
    },
  });

  await prisma.loginTentativa.create({
    data: {
      email,
      usuarioId: userId,
      sucesso: false,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      motivo,
    },
  });

  if (updatedUser.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    await prisma.usuario.update({
      where: { id: userId },
      data: {
        lockedUntil: plusMs(LOCKOUT_DURATION_MS),
      },
    });
  }

  return updatedUser;
};

const resetLoginAttempts = async (
  userId: string,
  email: string,
  ctx: LoginContext
) => {
  await prisma.usuario.update({
    where: { id: userId },
    data: {
      loginAttempts: 0,
      lockedUntil: null,
      lastFailedAttempt: null,
    },
  });

  await prisma.loginTentativa.create({
    data: {
      email,
      usuarioId: userId,
      sucesso: true,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      motivo: "Login bem-sucedido",
    },
  });
};

export const loginService = async (
  email: string,
  password: string,
  ctx: LoginContext = {}
) => {
  const user = await prisma.usuario.findUnique({
    where: { emailPessoal: email },
  });

  if (!user) {
    await prisma.loginTentativa.create({
      data: {
        email,
        sucesso: false,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        motivo: "Usuário não encontrado",
      },
    });
    throw new Error("Usuário ou senha inválidos");
  }

  if (!user.ativo || !user.senhaHash) {
    await prisma.loginTentativa.create({
      data: {
        email,
        usuarioId: user.id,
        sucesso: false,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        motivo: "Conta inativa",
      },
    });
    throw new Error("Usuário ou senha inválidos");
  }

  const isLocked = await checkAccountLock(user);
  if (isLocked) {
    const remainingTime = Math.ceil(
      (user.lockedUntil!.getTime() - Date.now()) / 1000
    );
    await prisma.loginTentativa.create({
      data: {
        email,
        usuarioId: user.id,
        sucesso: false,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        motivo: `Conta bloqueada - ${remainingTime}s restantes`,
      },
    });
    throw new Error(
      `Conta bloqueada devido a muitas tentativas. Tente novamente em ${Math.ceil(
        remainingTime / 60
      )} minutos.`
    );
  }

  const ok = await argon2.verify(user.senhaHash, password);
  if (!ok) {
    const updatedUser = await recordFailedAttempt(user.id, email, ctx);
    const attemptsLeft = MAX_LOGIN_ATTEMPTS - updatedUser.loginAttempts;

    if (attemptsLeft <= 0) {
      throw new Error(
        "Conta bloqueada devido a muitas tentativas falhas. Tente novamente em 15 minutos."
      );
    }

    throw new Error(
      `Usuário ou senha inválidos. ${attemptsLeft} tentativas restantes.`
    );
  }

  await resetLoginAttempts(user.id, email, ctx);

  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? undefined,
    role: user.papel,
  });

  const refreshToken = generateRefreshToken({ sub: user.id });
  const refreshHash = await hashValue(refreshToken);

  await prisma.sessao.create({
    data: {
      usuarioId: user.id,
      refreshHash,
      expiraEm: plusMs(REFRESH_TTL_MS),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });

  return { accessToken, refreshToken, user };
};

export const refreshService = async (refreshToken: string) => {
  const refreshHash = await hashValue(refreshToken);

  const session = await prisma.sessao.findFirst({
    where: { refreshHash, revogadaEm: null },
    include: { usuario: true },
  });

  if (!session) throw new Error("Sessão não encontrada ou expirada");

  if (session.expiraEm && session.expiraEm < new Date()) {
    try {
      await prisma.sessao.update({
        where: { id: session.id },
        data: { revogadaEm: new Date() },
      });
    } catch {}
    throw new Error("Sessão expirada");
  }

  const user = session.usuario;
  if (!user || !user.ativo) throw new Error("Usuário inativo");

  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? undefined,
    role: user.papel,
  });

  const newRefresh = generateRefreshToken({ sub: user.id });
  const newRefreshHash = await hashValue(newRefresh);

  const novaSessao = await prisma.sessao.create({
    data: {
      usuarioId: user.id,
      refreshHash: newRefreshHash,
      expiraEm: plusMs(REFRESH_TTL_MS),
      ip: session.ip ?? null,
      userAgent: session.userAgent ?? null,
    },
  });

  await prisma.sessao.update({
    where: { id: session.id },
    data: {
      revogadaEm: new Date(),
      substituidaPorId: novaSessao.id,
    },
  });

  return { accessToken, refreshToken: newRefresh };
};

export const logoutService = async (refreshToken: string) => {
  const refreshHash = await hashValue(refreshToken);

  const session = await prisma.sessao.findFirst({
    where: { refreshHash, revogadaEm: null },
    select: { id: true },
  });

  if (!session) throw new Error("Sessão não encontrada");

  await prisma.sessao.update({
    where: { id: session.id },
    data: { revogadaEm: new Date() },
  });

  return { success: true };
};

export const meService = async (userId: string) => {
  const user = await prisma.usuario.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nome: true,
      emailPessoal: true,
      emailEducacional: true,
      ra: true,
      papel: true,
      ativo: true,
      criadoEm: true,
      atualizadoEm: true,
    },
  });

  if (!user) throw new Error("Usuário não encontrado");
  return user;
};
