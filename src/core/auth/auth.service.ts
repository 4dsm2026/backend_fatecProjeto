import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { generateAccessToken, generateRefreshToken } from "../../utils/jwt";
import { hashValue } from "../../utils/crypto";

const prisma = new PrismaClient();

type LoginContext = {
  ip?: string | null;
  userAgent?: string | null;
};

/** TTLs */
const ACCESS_TTL_MIN = 15;              // access: 15 min
const REFRESH_TTL_DAYS = 7;             // refresh: 7 dias
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

function plusMs(ms: number) {
  return new Date(Date.now() + ms);
}

/** LOGIN */
export const loginService = async (
  email: string,
  password: string,
  ctx: LoginContext = {}
) => {
  const user = await prisma.usuario.findUnique({
    where: { emailPessoal: email },
  });

  if (!user || !user.ativo || !user.senhaHash) {
    throw new Error("Usuário ou senha inválidos");
  }

  const ok = await argon2.verify(user.senhaHash, password);
  if (!ok) throw new Error("Usuário ou senha inválidos");

  // Access (com exp curto)
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? undefined,
    role: user.papel, // enum Papel
    exp: Math.floor((Date.now() + ACCESS_TTL_MIN * 60 * 1000) / 1000),
  });

  // Refresh (opaco ou JWT — aqui tanto faz; vamos só guardar o HASH no banco)
  const refreshToken = generateRefreshToken({ sub: user.id });
  const refreshHash = await hashValue(refreshToken);

  await prisma.sessao.create({
    data: {
      usuarioId: user.id,
      refreshHash,
      expiraEm: plusMs(REFRESH_TTL_MS),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      // ultimoUsoEm é default(now()) na migration; se quiser atualizar já:
      // ultimoUsoEm: new Date(),
    },
  });

  return { accessToken, refreshToken, user };
};

/** REFRESH: emite NOVO access e faz rotação do refresh (revoga o antigo e cria outro) */
export const refreshService = async (refreshToken: string) => {
  const refreshHash = await hashValue(refreshToken);

  const session = await prisma.sessao.findFirst({
    where: { refreshHash, revogadaEm: null },
    include: { usuario: true },
  });

  if (!session) throw new Error("Sessão não encontrada ou expirada");

  if (session.expiraEm && session.expiraEm < new Date()) {
    // expirada → marca como revogada/expirada e erra
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

  // Novo access
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? undefined,
    role: user.papel,
    exp: Math.floor((Date.now() + ACCESS_TTL_MIN * 60 * 1000) / 1000),
  });

  // Rotação do refresh: cria novo refresh + nova sessão e aponta substituição
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

  // Revoga a sessão antiga e liga a nova
  await prisma.sessao.update({
    where: { id: session.id },
    data: {
      revogadaEm: new Date(),
      substituidaPorId: novaSessao.id, // requer campo na tabela; comente se ainda não migrou
      // ultimoUsoEm: new Date(),
    },
  });

  return { accessToken, refreshToken: newRefresh };
};

/** LOGOUT: revoga o refresh atual (idempotente) */
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

/** ME (dados públicos do usuário autenticado) */
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
