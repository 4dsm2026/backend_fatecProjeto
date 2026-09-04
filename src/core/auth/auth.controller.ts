// src/core/auth/auth.controller.ts
import crypto from "node:crypto";
import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import {
  LoginSchema,
  RegisterSchema,
  RefreshSchema,
  FirstAccessSchema,
  EsqueciSenhaSchema,
  ResetSenhaSchema,
  TrocarSenhaSchema,
} from "../../validators/auth";
import { hashPassword, verifyPassword } from "../../security/password";
import { generateAccessToken } from "../../utils/jwt";
import { registrarAuditoria } from "../../lib/auditoria";
import {
  generateRefreshToken as genRT,
  createSession,
  createSessionWithClient,
  verifyAndGetSession,
  rotateSession,
  REFRESH_TOKEN_TTL_MS,
} from "../../security/refresh";
import {
  enviarLinkEsqueciSenha,
  validarPoliticaSenha,
  consumirTokenSenha,
} from "../../core/auth/reset-senha.service";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ===================== CONFIG ===================== */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_ACCESS_EXPIRES = 15 * 60;

// COOKIE_SECURE=true apenas quando o site roda em HTTPS.
// NODE_ENV=production não garante HTTPS (ex: IP direto na AWS sem TLS).
const cookieSecure = process.env.COOKIE_SECURE === "true";

function parseExpires(v?: string | number) {
  if (!v) return DEFAULT_ACCESS_EXPIRES;
  if (typeof v === "number") return Number(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([0-9]+)m$/.exec(s);
  if (m) return Number(m[1]) * 60;
  const h = /^([0-9]+)h$/.exec(s);
  if (h) return Number(h[1]) * 3600;
  return DEFAULT_ACCESS_EXPIRES;
}

/* ===================== Cookies helper ===================== */
function setAuthCookies(res: FastifyReply, accessToken: string, refreshToken: string) {
  const r = res as any;
  if (typeof r.setCookie !== "function") {
    try {
      (res as any).request?.log?.warn?.("setCookie não disponível no FastifyReply — pulando setAuthCookies");
    } catch {}
    return;
  }
  const maxAge = parseExpires(process.env.JWT_ACCESS_EXPIRES);
  r.setCookie("accessToken", accessToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSecure ? "none" : "lax",
    path: "/",
    maxAge,
  });
  r.setCookie("refreshToken", refreshToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSecure ? "none" : "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_MS / 1000,
  });
}

/* ===================== Helpers de bloqueio ===================== */
const checkAccountLock = async (prisma: any, user: any) => {
  if (!user.lockedUntil) return false;
  if (user.lockedUntil < new Date()) {
    await prisma.usuario.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null, lastFailedAttempt: null },
    });
    return false;
  }
  return true;
};

const recordFailedAttempt = async (
  prisma: any,
  userId: string,
  email: string,
  ip: string,
  userAgent: string,
  motivo = "senha_incorreta",
) => {
  const updatedUser = await prisma.usuario.update({
    where: { id: userId },
    data: { loginAttempts: { increment: 1 }, lastFailedAttempt: new Date() },
  });
  await prisma.loginTentativa.create({
    data: { email, usuarioId: userId, sucesso: false, ip, userAgent, motivo },
  });
  if (updatedUser.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    await prisma.usuario.update({ where: { id: userId }, data: { lockedUntil } });
    await prisma.loginTentativa.create({
      data: {
        email,
        usuarioId: userId,
        sucesso: false,
        ip,
        userAgent,
        motivo: `conta_bloqueada_${Math.ceil(LOCKOUT_DURATION_MS / 60000)}min`,
      },
    });
  }
  return updatedUser;
};

const resetLoginAttempts = async (
  prisma: any,
  userId: string,
  email: string,
  ip: string,
  userAgent: string,
) => {
  await prisma.usuario.update({
    where: { id: userId },
    data: { loginAttempts: 0, lockedUntil: null, lastFailedAttempt: null },
  });
  await prisma.loginTentativa.create({
    data: { email, usuarioId: userId, sucesso: true, ip, userAgent, motivo: "login_sucesso" },
  });
};

/* Campos retornados em /me e /usuarios */
const userPublicSelect = {
  id: true,
  nome: true,
  emailPessoal: true,
  emailEducacional: true,
  ra: true,
  cursoNome: true,
  cursoSigla: true,
  papel: true,
  ativo: true,
  precisaTrocarSenha: true,
  passwordUpdatedAt: true,
  criadoEm: true,
  atualizadoEm: true,
  // Dados acadêmicos
  unidadeFatec: true,
  curso: true,
  eixoTecnologico: true,
  turno: true,
  turma: true,
  semestreAtual: true,
  matrizCurricular: true,
  situacaoAcademica: true,
  anoSemestreIngresso: true,
  coordenadorCurso: true,
  // Contato e acessibilidade
  telefoneCelular: true,
  whatsapp: true,
  canalPreferencialContato: true,
  melhorPeriodoContato: true,
  necessitaAtendimentoAcessivel: true,
  tipoAcessibilidade: true,
  observacoesAtendimento: true,
  notificacoesInApp: true,
} as const;

/* ===================== LOGIN ===================== */
const loginValidator = buildRouteValidator({ body: LoginSchema });

export const login = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  req.log.info("🔹 Iniciando login...");

  const parsed = loginValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = req.server.prisma;
  const { email, ra, password } = parsed.data!.body! as { email?: string; ra?: string; password: string };

  const ip = req.ip;
  const userAgent = String(req.headers["user-agent"] || "");
  const identificador = email ?? ra ?? "";

  await registrarAuditoria({
    feitoPorId: null,
    acao: "login_tentativa",
    alvo: identificador,
    meta: { identificador, ip, userAgent }
  });

  try {
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

    const user = email
      ? await prisma.usuario.findUnique({ where: { emailPessoal: email }, select: loginSelect })
      : await prisma.usuario.findUnique({ where: { ra: ra! }, select: loginSelect });

    if (!user) {
      await registrarAuditoria({ feitoPorId: null, acao: "login_falha_usuario_inexistente", alvo: identificador, meta: { identificador } });
      await prisma.loginTentativa.create({ data: { email: email ?? "", usuarioId: null, sucesso: false, ip, userAgent, motivo: "usuario_nao_encontrado" } });
      req.log.warn({ identificador }, "❌ Usuário não encontrado");
      await res.code(401).send({ error: "Credenciais inválidas" });
      return;
    }

    const isLocked = await checkAccountLock(prisma, user);
    if (isLocked) {
      const remainingTime = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 1000);
      const remainingMinutes = Math.max(1, Math.ceil(remainingTime / 60));
      await registrarAuditoria({ feitoPorId: user.id, acao: "login_falha_conta_bloqueada", alvo: user.emailPessoal, meta: { remainingMinutes } });
      await prisma.loginTentativa.create({ data: { email: user.emailPessoal ?? "", usuarioId: user.id, sucesso: false, ip, userAgent, motivo: `conta_bloqueada_${remainingMinutes}min_restantes` } });
      req.log.warn({ identificador, userId: user.id }, "🔒 Tentativa em conta bloqueada");
      await res.code(423).send({ error: "Conta bloqueada", message: `Muitas tentativas de login. Tente novamente em ${remainingMinutes} minutos.`, remainingTime });
      return;
    }

    if (!user.ativo) {
      await registrarAuditoria({ feitoPorId: user.id, acao: "login_falha_usuario_inativo", alvo: user.emailPessoal, meta: {} });
      await prisma.loginTentativa.create({ data: { email: user.emailPessoal ?? "", usuarioId: user.id, sucesso: false, ip, userAgent, motivo: "usuario_inativo" } });
      req.log.warn({ identificador }, "⚠️ Usuário inativo");
      await res.code(403).send({ error: "Usuário inativo" });
      return;
    }

    if (!user.senhaHash) {
      await registrarAuditoria({ feitoPorId: user.id, acao: "login_falha_hash_ausente", alvo: user.emailPessoal, meta: {} });
      await prisma.loginTentativa.create({ data: { email: user.emailPessoal ?? "", usuarioId: user.id, sucesso: false, ip, userAgent, motivo: "hash_senha_ausente" } });
      req.log.warn({ identificador }, "❌ Hash de senha ausente");
      await res.code(401).send({ error: "Credenciais inválidas" });
      return;
    }

    const passwordValid = await verifyPassword(user.senhaHash, password);
    if (!passwordValid) {
      const updatedUser = await recordFailedAttempt(prisma, user.id, user.emailPessoal ?? "", ip, userAgent);
      const attemptsLeft = MAX_LOGIN_ATTEMPTS - updatedUser.loginAttempts;
      await registrarAuditoria({ feitoPorId: user.id, acao: "login_falha_senha_incorreta", alvo: user.emailPessoal, meta: { attemptsLeft } });
      let errorMessage = "Credenciais inválidas";
      if (attemptsLeft <= 0) errorMessage = "Conta bloqueada por muitas tentativas. Tente novamente em 15 minutos.";
      else if (attemptsLeft <= 2) errorMessage = `Credenciais inválidas. ${attemptsLeft} tentativa(s) restante(s) antes do bloqueio.`;
      req.log.warn({ identificador, attemptsLeft }, "❌ Senha incorreta");
      await res.code(401).send({ error: errorMessage, attemptsLeft });
      return;
    }

    if (user.precisaTrocarSenha) {
      await registrarAuditoria({ feitoPorId: user.id, acao: "login_primeiro_acesso", alvo: user.emailPessoal, meta: {} });
      await resetLoginAttempts(prisma, user.id, user.emailPessoal ?? "", ip, userAgent);
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await prisma.tokenResetSenha.create({
        data: { usuarioId: user.id, tokenHash, expiraEm: new Date(Date.now() + 1000 * 60 * 60 * 24) },
      });
      req.log.info({ userId: user.id }, "🔁 precisaTrocarSenha ativo — exigir troca de senha");
      await res.code(428).send({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "É necessário trocar a senha no primeiro acesso.",
        token: rawToken,
        user: { id: user.id, nome: user.nome, ra: user.ra, papel: user.papel },
      });
      return;
    }

    await resetLoginAttempts(prisma, user.id, user.emailPessoal ?? "", ip, userAgent);
    await registrarAuditoria({ feitoPorId: user.id, acao: "login_sucesso", alvo: user.emailPessoal, meta: {} });

    const accessToken = generateAccessToken({ sub: user.id, email: user.emailPessoal ?? "", role: user.papel });
    const { token: refreshToken } = genRT();
    await createSession({ usuarioId: user.id, refreshToken, ip, userAgent, expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) });
    setAuthCookies(res, accessToken, refreshToken);

    const { senhaHash, loginAttempts, lockedUntil, lastFailedAttempt, ...safeUser } = user as any;
    await res.send({ user: safeUser, accessToken, refreshToken });
  } catch (e: any) {
    req.log.error({ errMessage: e?.message, errName: e?.name, errStack: e?.stack }, "💥 Erro no login (detalhado)");
    await res.code(500).send({ error: errMsg(e), debug: e?.message ?? "unknown_error" });
  }
};

/* ===================== PRIMEIRO ACESSO (via token) ===================== */
const firstAccessValidator = buildRouteValidator({ body: FirstAccessSchema });

export const firstAccess = async (req: FastifyRequest, res: FastifyReply) => {
  const parsed = firstAccessValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const { token, newPassword, personalEmail } = parsed.data!.body! as unknown as {
    token: string;
    newPassword: string;
    personalEmail?: string;
  };

  const prisma = req.server.prisma;

  try {
    if (!validarPoliticaSenha(newPassword)) {
      await res.code(400).send({ error: "Senha não atende aos critérios mínimos." });
      return;
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRow = await prisma.tokenResetSenha.findFirst({
      where: { tokenHash, usadoEm: null, expiraEm: { gt: new Date() } },
      include: { usuario: true },
    });

    if (!tokenRow || !tokenRow.usuario) {
      await res.code(400).send({ error: "Token inválido ou expirado." });
      return;
    }

    const user = tokenRow.usuario;
    if (!user.ativo) {
      await res.code(403).send({ error: "Usuário inativo" });
      return;
    }

    if (personalEmail) {
      const dupe = await prisma.usuario.findUnique({ where: { emailPessoal: personalEmail }, select: { id: true } });
      if (dupe && dupe.id !== user.id) {
        await res.code(409).send({ error: "Este e-mail pessoal já está em uso" });
        return;
      }
    }

    const patch: any = { senhaHash: await hashPassword(newPassword), precisaTrocarSenha: false, passwordUpdatedAt: new Date() };
    if (personalEmail) patch.emailPessoal = personalEmail;

    const { updated } = await prisma.$transaction(async (tx: any) => {
      const updatedUser = await tx.usuario.update({
        where: { id: user.id },
        data: patch,
        select: { id: true, nome: true, papel: true, emailPessoal: true },
      });
      await tx.tokenResetSenha.update({ where: { id: tokenRow.id }, data: { usadoEm: new Date() } });
      return { updated: updatedUser };
    });

    const accessToken = generateAccessToken({ sub: updated.id, email: updated.emailPessoal ?? "", role: updated.papel });
    const { token: refreshToken } = genRT();
    await createSession({ usuarioId: updated.id, refreshToken, ip: req.ip, userAgent: String(req.headers["user-agent"] || ""), expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) });
    setAuthCookies(res, accessToken, refreshToken);
    await res.send({ user: updated, accessToken, refreshToken });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no primeiro acesso");
    await res.code(500).send({ error: "Erro ao concluir o primeiro acesso" });
  }
};

/* ===================== ESQUECI A SENHA ===================== */
const forgotPasswordValidator = buildRouteValidator({ body: EsqueciSenhaSchema });

export const forgotPassword = async (req: FastifyRequest, res: FastifyReply) => {
  const parsed = forgotPasswordValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }
  const { email } = parsed.data!.body! as { email: string };
  const prisma = req.server.prisma;
  try {
    await enviarLinkEsqueciSenha(prisma, email.trim().toLowerCase());
    await res.send({ message: "Se existir uma conta com esse e-mail, enviaremos um link para redefinir a senha." });
  } catch (e) {
    req.log.error({ e }, "💥 Erro em esqueci-senha");
    await res.code(500).send({ error: "Erro ao processar a solicitação de redefinição de senha" });
  }
};

/* ===================== RESET DE SENHA (via token) ===================== */
const resetPasswordValidator = buildRouteValidator({ body: ResetSenhaSchema });

export const resetPassword = async (req: FastifyRequest, res: FastifyReply) => {
  const parsed = resetPasswordValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }
  const { token, newPassword } = parsed.data!.body! as { token: string; newPassword: string };
  const prisma = req.server.prisma;
  try {
    if (!validarPoliticaSenha(newPassword)) {
      await res.code(400).send({ error: "Senha não atende aos critérios mínimos." });
      return;
    }
    const basicUser = await consumirTokenSenha(prisma, token, newPassword);
    if (!basicUser) {
      await res.code(400).send({ error: "Token inválido ou expirado." });
      return;
    }
    const userDb = await prisma.usuario.findUnique({
      where: { id: basicUser.id },
      select: { id: true, nome: true, ra: true, papel: true, emailPessoal: true },
    });
    if (!userDb) {
      await res.code(404).send({ error: "Usuário não encontrado" });
      return;
    }
    const accessToken = generateAccessToken({ sub: userDb.id, email: userDb.emailPessoal ?? "", role: userDb.papel });
    const { token: refreshToken } = genRT();
    await createSession({ usuarioId: userDb.id, refreshToken, ip: req.ip, userAgent: String(req.headers["user-agent"] || ""), expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) });
    setAuthCookies(res, accessToken, refreshToken);
    await res.send({ user: userDb, accessToken, refreshToken });
  } catch (e: any) {
    req.log.error({ e }, "💥 Erro no reset de senha");
    await res.code(e?.statusCode ?? 500).send({ error: e?.message ?? "Erro ao redefinir senha" });
  }
};

/* ===================== REGISTER ===================== */
const registerValidator = buildRouteValidator({ body: RegisterSchema });

export const register = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = registerValidator.parse(req);
  if ("error" in parsed) { await res.code(400).send(parsed.error); return; }
  const prisma = req.server.prisma;
  const { email, password, role, name, educationalEmail, ra } = parsed.data!.body! as {
    email: string; password: string; role?: any; name: string; educationalEmail?: string; ra?: string;
  };
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existsEmail = await tx.usuario.findUnique({ where: { emailPessoal: email }, select: { id: true } });
      if (existsEmail) { const err: any = new Error("Email já está em uso"); err.statusCode = 409; throw err; }
      if (ra) {
        const existsRa = await tx.usuario.findUnique({ where: { ra }, select: { id: true } });
        if (existsRa) { const err: any = new Error("RA já está em uso"); err.statusCode = 409; throw err; }
      }
      const senhaHash = await hashPassword(password);
      const user = await tx.usuario.create({
        data: { nome: name, emailPessoal: email, emailEducacional: educationalEmail ?? null, ra: ra ?? null, senhaHash, papel: role, ativo: true, precisaTrocarSenha: !!ra, passwordUpdatedAt: new Date() },
        select: { id: true, nome: true, emailPessoal: true, emailEducacional: true, ra: true, papel: true, ativo: true, precisaTrocarSenha: true, criadoEm: true, atualizadoEm: true },
      });
      const accessToken = generateAccessToken({ sub: user.id, email: user.emailPessoal ?? "", role: user.papel });
      const { token: refreshToken } = genRT();
      await createSessionWithClient(tx, { usuarioId: user.id, refreshToken, ip: req.ip, userAgent: String(req.headers["user-agent"] || ""), expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) });
      return { user, accessToken, refreshToken };
    });
    setAuthCookies(res, result.accessToken, result.refreshToken);
    await res.send(result);
  } catch (e: any) {
    req.log.error({ e }, "💥 Erro no registro");
    if (e?.statusCode === 409 || e?.code === "P2002") {
      const msg = String(e?.message || "").toLowerCase().includes("ra") ? "RA já está em uso" : "Email já está em uso";
      await res.code(409).send({ error: msg }); return;
    }
    await res.code(500).send({ error: "Erro ao criar o usuário", details: errMsg(e) });
  }
};

/* ===================== REFRESH ===================== */
const refreshValidator = buildRouteValidator({ body: RefreshSchema });

export const refresh = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = refreshValidator.parse(req);
  if ("error" in parsed) { await res.code(400).send(parsed.error); return; }
  const prisma = req.server.prisma;
  const { refreshToken } = parsed.data!.body! as { refreshToken: string };
  try {
    const sessao = await verifyAndGetSession(refreshToken);
    if (!sessao) { await res.code(401).send({ error: "Refresh inválido" }); return; }
    const user = await prisma.usuario.findUniqueOrThrow({
      where: { id: sessao.usuarioId },
      select: { id: true, emailPessoal: true, papel: true },
    });
    const accessToken = generateAccessToken({ sub: user.id, email: user.emailPessoal ?? "", role: user.papel });
    const { token: novoRefresh } = genRT();
    await rotateSession(sessao.id, novoRefresh);
    setAuthCookies(res, accessToken, novoRefresh);
    await res.send({ accessToken, refreshToken: novoRefresh });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no refresh");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ===================== LOGOUT ===================== */
export const logout = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = refreshValidator.parse(req);
  if ("error" in parsed) { await res.code(400).send(parsed.error); return; }
  const prisma = req.server.prisma;
  const { refreshToken } = parsed.data!.body! as { refreshToken: string };
  try {
    const sessao = await verifyAndGetSession(refreshToken);
    if (sessao) await prisma.sessao.update({ where: { id: sessao.id }, data: { revogadaEm: new Date() } });
    await res.send({ message: "Logout OK" });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no logout");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ===================== ME ===================== */
export const me = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const prisma = req.server.prisma;
  const authUser = req.user as { sub?: string } | undefined;
  if (!authUser?.sub) { await res.code(401).send({ error: "Não autenticado" }); return; }
  try {
    const user = await prisma.usuario.findUnique({
      where: { id: authUser.sub },
      select: userPublicSelect,
    });
    if (!user) { await res.code(404).send({ error: "Usuário não encontrado" }); return; }
    await res.send(user);
  } catch (e) {
    req.log.error({ e }, "💥 Erro no /me");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ===================== TROCAR SENHA (autenticado) ===================== */
const trocarSenhaValidator = buildRouteValidator({ body: TrocarSenhaSchema });

export const trocarSenha = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = trocarSenhaValidator.parse(req);
  if ("error" in parsed) { await res.code(400).send(parsed.error); return; }

  const prisma = req.server.prisma;
  const authUser = req.user as { sub?: string } | undefined;
  if (!authUser?.sub) { await res.code(401).send({ error: "Não autenticado" }); return; }

  const { senhaAtual, novaSenha } = parsed.data!.body! as { senhaAtual: string; novaSenha: string };

  try {
    const user = await prisma.usuario.findUnique({
      where: { id: authUser.sub },
      select: { id: true, senhaHash: true },
    });
    if (!user?.senhaHash) { await res.code(404).send({ error: "Usuário não encontrado" }); return; }

    const senhaConfere = await verifyPassword(user.senhaHash, senhaAtual);
    if (!senhaConfere) {
      await registrarAuditoria({ feitoPorId: user.id, acao: "troca_senha_falha", alvo: user.id, meta: { motivo: "senha_atual_incorreta" } });
      await res.code(400).send({ error: "Senha atual incorreta" });
      return;
    }

    if (!validarPoliticaSenha(novaSenha)) {
      await res.code(400).send({ error: "A nova senha não atende aos critérios mínimos." });
      return;
    }

    const novoHash = await hashPassword(novaSenha);
    await prisma.usuario.update({
      where: { id: user.id },
      data: { senhaHash: novoHash, precisaTrocarSenha: false, passwordUpdatedAt: new Date() },
    });

    // Invalida as demais sessões: uma troca de senha deve encerrar acessos antigos.
    await prisma.sessao.updateMany({
      where: { usuarioId: user.id, revogadaEm: null },
      data: { revogadaEm: new Date() },
    });

    await registrarAuditoria({ feitoPorId: user.id, acao: "troca_senha_sucesso", alvo: user.id, meta: {} });
    await res.send({ message: "Senha alterada com sucesso" });
  } catch (e) {
    req.log.error({ e }, "💥 Erro ao trocar senha");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ===================== GET /usuarios (consulta simples) ===================== */
export const getUser = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const prisma = req.server.prisma;
  const { ra, email, id, name, educationalEmail } = (req.query ?? {}) as {
    ra?: string; email?: string; id?: string; name?: string; educationalEmail?: string;
  };
  const where: any = {};
  if (id) where.id = id;
  if (ra) where.ra = ra;
  if (email) where.emailPessoal = email;
  if (educationalEmail) where.emailEducacional = educationalEmail;
  if (name) where.nome = { contains: name };
  try {
    const users = await prisma.usuario.findMany({ where, select: userPublicSelect });
    if (!users.length) { await res.code(404).send({ error: "Usuário não encontrado" }); return; }
    await res.send(users);
  } catch (e) {
    req.log.error({ e }, "💥 Erro em /usuarios");
    await res.code(500).send({ error: errMsg(e) });
  }
};
