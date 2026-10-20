import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toResource } from "../../hateoas";
import { registrarAuditoria } from "../../lib/auditoria";
import { verifyDummyPassword } from "../../security/dummy-verify";
import { createSession, REFRESH_TOKEN_TTL_MS, generateRefreshToken as genRT } from "../../security/refresh";
import { verifyPassword } from "../../security/password";
import { generateAccessToken } from "../../utils/jwt";
import { LoginSchema } from "../../validators/auth";
import type { z } from "zod";
import {
  MAX_LOGIN_ATTEMPTS,
  checkAccountLock,
  recordFailedAttempt,
  resetLoginAttempts,
  setAuthCookies,
} from "../auth/auth.controller";
import { buildActivationRequiredLinks, buildSessionLinks } from "./sessions.links";
import { FINALIDADE_PRIMEIRO_ACESSO } from "../auth/token-finalidade";

const loginSelect = {
  id: true,
  nome: true,
  ra: true,
  papel: true,
  senhaHash: true,
  emailPessoal: true,
  ativo: true,
  loginAttempts: true,
  lockedUntil: true,
  lastFailedAttempt: true,
  precisaTrocarSenha: true,
} as const;

type LoginCredentials = Pick<z.infer<typeof LoginSchema>, "email" | "ra">;
type LoginUser = NonNullable<Awaited<ReturnType<typeof findLoginUser>>>;
type LoginPrisma = FastifyRequest["server"]["prisma"];

async function findLoginUser(
  prisma: LoginPrisma,
  { email, ra }: LoginCredentials,
) {
  if (email) {
    return prisma.usuario.findUnique({ where: { emailPessoal: email }, select: loginSelect });
  }
  if (ra) {
    return prisma.usuario.findUnique({ where: { ra }, select: loginSelect });
  }
  throw new ApiError("bad-request", "Dados inválidos");
}

async function rejectUnknownUser(
  req: FastifyRequest,
  prisma: LoginPrisma,
  password: string,
  email: string | undefined,
  identifier: string,
  ip: string,
  userAgent: string,
): Promise<never> {
  await verifyDummyPassword(password);
  await registrarAuditoria({
    feitoPorId: null,
    acao: "login_falha_usuario_inexistente",
    alvo: identifier,
    meta: { identificador: identifier },
  });
  await prisma.loginTentativa.create({
    data: {
      email: email ?? "",
      usuarioId: null,
      sucesso: false,
      ip,
      userAgent,
      motivo: "usuario_nao_encontrado",
    },
  });
  req.log.warn({ identificador: identifier }, "❌ Usuário não encontrado");
  throw new ApiError("unauthorized", "Credenciais inválidas");
}

async function rejectLockedAccount(
  req: FastifyRequest,
  prisma: LoginPrisma,
  user: LoginUser,
  identifier: string,
  ip: string,
  userAgent: string,
): Promise<never> {
  const remainingTime = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 1000);
  const remainingMinutes = Math.max(1, Math.ceil(remainingTime / 60));
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_falha_conta_bloqueada",
    alvo: user.emailPessoal,
    meta: { remainingMinutes },
  });
  await prisma.loginTentativa.create({
    data: {
      email: user.emailPessoal ?? "",
      usuarioId: user.id,
      sucesso: false,
      ip,
      userAgent,
      motivo: `conta_bloqueada_${remainingMinutes}min_restantes`,
    },
  });
  req.log.warn({ identificador: identifier, userId: user.id }, "🔒 Tentativa em conta bloqueada");
  throw new ApiError(
    "too-many-requests",
    "Conta bloqueada",
    `Muitas tentativas de login. Tente novamente em ${remainingMinutes} minutos.`,
    undefined,
    {
      type: "/errors/account-locked",
      extensions: { retryAfter: remainingTime },
      headers: { "Retry-After": String(remainingTime) },
    },
  );
}

async function rejectInactiveUser(
  req: FastifyRequest,
  prisma: LoginPrisma,
  user: LoginUser,
  identifier: string,
  ip: string,
  userAgent: string,
): Promise<never> {
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_falha_usuario_inativo",
    alvo: user.emailPessoal,
    meta: {},
  });
  await prisma.loginTentativa.create({
    data: {
      email: user.emailPessoal ?? "",
      usuarioId: user.id,
      sucesso: false,
      ip,
      userAgent,
      motivo: "usuario_inativo",
    },
  });
  req.log.warn({ identificador: identifier }, "⚠️ Usuário inativo");
  throw new ApiError("forbidden", "Usuário inativo");
}

async function rejectMissingHash(
  req: FastifyRequest,
  prisma: LoginPrisma,
  user: LoginUser,
  password: string,
  identifier: string,
  ip: string,
  userAgent: string,
): Promise<never> {
  await verifyDummyPassword(password);
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_falha_hash_ausente",
    alvo: user.emailPessoal,
    meta: {},
  });
  await prisma.loginTentativa.create({
    data: {
      email: user.emailPessoal ?? "",
      usuarioId: user.id,
      sucesso: false,
      ip,
      userAgent,
      motivo: "hash_senha_ausente",
    },
  });
  req.log.warn({ identificador: identifier }, "❌ Hash de senha ausente");
  throw new ApiError("unauthorized", "Credenciais inválidas");
}

async function rejectWrongPassword(
  req: FastifyRequest,
  prisma: LoginPrisma,
  user: LoginUser,
  identifier: string,
  ip: string,
  userAgent: string,
): Promise<never> {
  const updatedUser = await recordFailedAttempt(
    prisma,
    user.id,
    user.emailPessoal ?? "",
    ip,
    userAgent,
  );
  const attemptsLeft = MAX_LOGIN_ATTEMPTS - updatedUser.loginAttempts;
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_falha_senha_incorreta",
    alvo: user.emailPessoal,
    meta: { attemptsLeft },
  });
  let detail: string | undefined;
  if (attemptsLeft <= 0) {
    detail = "Conta bloqueada por muitas tentativas. Tente novamente em 15 minutos.";
  } else if (attemptsLeft <= 2) {
    detail = `Credenciais inválidas. ${attemptsLeft} tentativa(s) restante(s) antes do bloqueio.`;
  }
  req.log.warn({ identificador: identifier, attemptsLeft }, "❌ Senha incorreta");
  throw new ApiError("unauthorized", "Credenciais inválidas", detail, undefined, {
    extensions: { attemptsLeft },
  });
}

async function rejectPasswordChangeRequired(
  req: FastifyRequest,
  prisma: LoginPrisma,
  user: LoginUser,
  ip: string,
  userAgent: string,
): Promise<never> {
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_primeiro_acesso",
    alvo: user.emailPessoal,
    meta: {},
  });
  await resetLoginAttempts(prisma, user.id, user.emailPessoal ?? "", ip, userAgent);
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await prisma.tokenResetSenha.create({
    data: {
      usuarioId: user.id,
      tokenHash,
      finalidade: FINALIDADE_PRIMEIRO_ACESSO,
      expiraEm: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });
  req.log.info({ userId: user.id }, "🔁 precisaTrocarSenha ativo — exigir troca de senha");
  throw new ApiError(
    "forbidden",
    "Troca de senha obrigatória",
    "É necessário definir uma nova senha no primeiro acesso.",
    undefined,
    {
      type: "/errors/password-change-required",
      extensions: { _links: buildActivationRequiredLinks(rawToken) },
    },
  );
}

async function createLoginSession(
  req: FastifyRequest,
  res: FastifyReply,
  user: LoginUser,
  ip: string,
  userAgent: string,
): Promise<void> {
  const prisma = req.server.prisma;
  await resetLoginAttempts(prisma, user.id, user.emailPessoal ?? "", ip, userAgent);
  await registrarAuditoria({
    feitoPorId: user.id,
    acao: "login_sucesso",
    alvo: user.emailPessoal,
    meta: {},
  });

  const { token: refreshToken } = genRT();
  const sessao = await createSession({
    usuarioId: user.id,
    refreshToken,
    ip,
    userAgent,
    expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? "",
    role: user.papel,
    sid: sessao.id,
  });
  setAuthCookies(res, accessToken, refreshToken);

  const publicUser = {
    id: user.id,
    nome: user.nome,
    ra: user.ra,
    papel: user.papel,
    emailPessoal: user.emailPessoal,
    ativo: user.ativo,
    precisaTrocarSenha: user.precisaTrocarSenha,
  };
  await res
    .code(201)
    .header("Location", "/sessions/current")
    .header("Cache-Control", "no-store")
    .send(toResource({ user: publicUser, accessToken, refreshToken }, buildSessionLinks()));
}

export const postSession = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  req.log.info("🔹 Iniciando login...");
  const { email, ra, password } = parseOrThrow(LoginSchema, req.body);
  const prisma = req.server.prisma;
  const ip = req.ip;
  const userAgent = String(req.headers["user-agent"] || "");
  const identifier = email ?? ra ?? "";

  await registrarAuditoria({
    feitoPorId: null,
    acao: "login_tentativa",
    alvo: identifier,
    meta: { identificador: identifier, ip, userAgent },
  });

  const user = await findLoginUser(prisma, { email, ra });
  if (!user) return rejectUnknownUser(req, prisma, password, email, identifier, ip, userAgent);
  if (await checkAccountLock(prisma, user)) {
    return rejectLockedAccount(req, prisma, user, identifier, ip, userAgent);
  }
  if (!user.ativo) return rejectInactiveUser(req, prisma, user, identifier, ip, userAgent);
  if (!user.senhaHash) {
    return rejectMissingHash(req, prisma, user, password, identifier, ip, userAgent);
  }
  if (!(await verifyPassword(user.senhaHash, password))) {
    return rejectWrongPassword(req, prisma, user, identifier, ip, userAgent);
  }
  if (user.precisaTrocarSenha) {
    return rejectPasswordChangeRequired(req, prisma, user, ip, userAgent);
  }

  await createLoginSession(req, res, user, ip, userAgent);
};
