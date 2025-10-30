// core/auth/auth.controller.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { buildRouteValidator } from "../../utils/zod-helpers";
import { LoginSchema, RegisterSchema, RefreshSchema } from "../../validators/auth";
import { hashPassword, verifyPassword } from "../../security/password";
import { generateAccessToken } from "../../utils/jwt";
import {
  generateRefreshToken as genRT,
  createSession,
  createSessionWithClient,
  verifyAndGetSession,
  rotateSession,
  REFRESH_TOKEN_TTL_MS,
} from "../../security/refresh";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function parseExpires(v?: string | number) {
  if (!v) return 15 * 60;
  if (typeof v === 'number') return Number(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([0-9]+)m$/.exec(s);
  if (m) return Number(m[1]) * 60;
  const h = /^([0-9]+)h$/.exec(s);
  if (h) return Number(h[1]) * 3600;
  return 15 * 60;
}

/* ============ LOGIN ============ */
const loginValidator = buildRouteValidator({ body: LoginSchema });

export const login = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  req.log.info("🔹 Iniciando login...");

  const parsed = loginValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = (req.server as any).prisma;
  const { email, ra, password } = parsed.data!.body! as {
    email?: string;
    ra?: string;
    password: string;
  };

  const ip = req.ip;
  const userAgent = String(req.headers["user-agent"] || "");
  const identificador = email ?? ra ?? "";

  try {
    // 🔍 Busca: funcionário por emailPessoal (único) | aluno por RA (único)
    const baseSelect = {
      id: true,
      nome: true,
      ra: true,
      papel: true,
      senhaHash: true,
      emailPessoal: true,
      ativo: true,
    } as const;

    const user = email
      ? await prisma.usuario.findUnique({ where: { emailPessoal: email }, select: baseSelect })
      : await prisma.usuario.findUnique({ where: { ra: ra! }, select: baseSelect });

    // Falha de credenciais (usuário não encontrado ou hash ausente ou senha inválida)
    if (!user || !user.senhaHash || !(await verifyPassword(user.senhaHash, password))) {
      await prisma.loginTentativa.create({
        data: {
          email: email ?? user?.emailPessoal ?? "",
          usuarioId: user?.id ?? null,
          sucesso: false,
          ip,
          userAgent,
          motivo: "credenciais_invalidas",
        },
      });
      req.log.warn({ identificador }, "❌ Credenciais inválidas");
      await res.code(401).send({ error: "Credenciais inválidas" });
      return;
    }

    // Usuário inativo
    if (!user.ativo) {
      await prisma.loginTentativa.create({
        data: {
          email: email ?? user.emailPessoal ?? "",
          usuarioId: user.id,
          sucesso: false,
          ip,
          userAgent,
          motivo: "usuario_inativo",
        },
      });
      req.log.warn({ identificador }, "⚠️ Usuário inativo");
      await res.code(403).send({ error: "Usuário inativo" });
      return;
    }

    // ✅ Tokens
    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.emailPessoal ?? "",
      role: user.papel,
    });

    const { token: refreshToken } = genRT();

    await createSession({
      usuarioId: user.id,
      refreshToken,
      ip,
      userAgent,
      expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    await prisma.loginTentativa.create({
      data: {
        email: email ?? user.emailPessoal ?? "",
        usuarioId: user.id,
        sucesso: true,
        ip,
        userAgent,
        motivo: "ok",
      },
    });

    req.log.info({ identificador }, "✅ Login concluído com sucesso");

    // Also set httpOnly cookie for access_token so browser navigations include it
    // Compute cookie maxAge from JWT_ACCESS_EXPIRES (simple support for minutes like '15m')
    const parseExpires = (v?: string | number) => {
      if (!v) return 15 * 60;
      if (typeof v === 'number') return Number(v);
      const s = String(v).trim();
      if (/^\d+$/.test(s)) return Number(s);
      const m = /^([0-9]+)m$/.exec(s);
      if (m) return Number(m[1]) * 60;
      const h = /^([0-9]+)h$/.exec(s);
      if (h) return Number(h[1]) * 3600;
      return 15 * 60;
    };
    const maxAge = parseExpires(process.env.JWT_ACCESS_EXPIRES);

    try {
      // set httpOnly cookie; front-end will still receive accessToken in body if needed
      (res as any).setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge,
      });
    } catch (e) {
      // if cookie plugin not installed, just continue — response will still include tokens
      req.log.debug('setCookie failed or cookie plugin not available');
    }

    // Não vazar senhaHash
    const { senhaHash, ...safeUser } = user as any;
    await res.send({ user: safeUser, accessToken, refreshToken });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no login");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ============ REGISTER ============ */
const registerValidator = buildRouteValidator({ body: RegisterSchema });

export const register = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = registerValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = (req.server as any).prisma;
  const { email, password, role, name, educationalEmail, ra } = parsed.data!.body! as {
    email: string;
    password: string;
    role?: any;
    name: string;
    educationalEmail?: string;
    ra?: string;
  };

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // e-mail pessoal único
      const existsEmail = await tx.usuario.findUnique({
        where: { emailPessoal: email },
        select: { id: true },
      });
      if (existsEmail) {
        const err: any = new Error("Email já está em uso");
        err.statusCode = 409;
        throw err;
      }

      // RA único (se fornecido)
      if (ra) {
        const existsRa = await tx.usuario.findUnique({
          where: { ra },
          select: { id: true },
        });
        if (existsRa) {
          const err: any = new Error("RA já está em uso");
          err.statusCode = 409;
          throw err;
        }
      }

      const senhaHash = await hashPassword(password);

      const user = await tx.usuario.create({
        data: {
          nome: name,
          emailPessoal: email,
          emailEducacional: educationalEmail ?? null,
          ra: ra ?? null,
          senhaHash,
          papel: role, // se quiser garantir default no banco, mantenha @default(USUARIO) no schema
          ativo: true,
        },
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

      const accessToken = generateAccessToken({
        sub: user.id,
        email: user.emailPessoal ?? "",
        role: user.papel,
      });

      const { token: refreshToken } = genRT();

      await createSessionWithClient(tx, {
        usuarioId: user.id,
        refreshToken,
        ip: req.ip,
        userAgent: String(req.headers["user-agent"] || ""),
        expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      });

      return { user, accessToken, refreshToken };
    });

    await res.send(result);
  } catch (e: any) {
    req.log.error({ e }, "💥 Erro no registro");
    if (e?.statusCode === 409 || e?.code === "P2002") {
      // P2002 = unique constraint
      const msg =
        String(e?.message || "").toLowerCase().includes("ra")
          ? "RA já está em uso"
          : "Email já está em uso";
      await res.code(409).send({ error: msg });
      return;
    }
    await res.code(500).send({ error: "Erro ao criar o usuário", details: errMsg(e) });
  }
};

/* ============ REFRESH TOKEN ============ */
const refreshValidator = buildRouteValidator({ body: RefreshSchema });

export const refresh = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = refreshValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = (req.server as any).prisma;
  const { refreshToken } = parsed.data!.body! as { refreshToken: string };

  try {
    const sessao = await verifyAndGetSession(refreshToken);
    if (!sessao) {
      await res.code(401).send({ error: "Refresh inválido" });
      return;
    }

    const user = await prisma.usuario.findUniqueOrThrow({
      where: { id: sessao.usuarioId },
      select: { id: true, emailPessoal: true, papel: true },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.emailPessoal ?? "",
      role: user.papel,
    });

    const { token: novoRefresh } = genRT();
    await rotateSession(sessao.id, novoRefresh);

    try {
      (res as any).setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: parseExpires(process.env.JWT_ACCESS_EXPIRES),
      });
    } catch {}

    await res.send({ accessToken, refreshToken: novoRefresh });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no refresh");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ============ LOGOUT ============ */
export const logout = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = refreshValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = (req.server as any).prisma;
  const { refreshToken } = parsed.data!.body! as { refreshToken: string };

  try {
    const sessao = await verifyAndGetSession(refreshToken);
    if (sessao) {
      await prisma.sessao.update({
        where: { id: sessao.id },
        data: { revogadaEm: new Date() },
      });
    }

    await res.send({ message: "Logout OK" });
  } catch (e) {
    req.log.error({ e }, "💥 Erro no logout");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ============ ME (usuário atual) ============ */
export const me = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const prisma = (req.server as any).prisma;
  const authUser = (req as any).user as { sub?: string } | undefined;

  if (!authUser?.sub) {
    await res.code(401).send({ error: "Não autenticado" });
    return;
  }

  try {
    const user = await prisma.usuario.findUnique({
      where: { id: authUser.sub },
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

    if (!user) {
      await res.code(404).send({ error: "Usuário não encontrado" });
      return;
    }

    await res.send(user);
  } catch (e) {
    req.log.error({ e }, "💥 Erro no /me");
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ============ GET /usuarios ============ */
export const getUser = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const prisma = (req.server as any).prisma;
  const { ra, email, id, name, educationalEmail } = (req.query ?? {}) as {
    ra?: string;
    email?: string;
    id?: string;
    name?: string;
    educationalEmail?: string;
  };

  const where: any = {};
  if (id) where.id = id;
  if (ra) where.ra = ra;
  if (email) where.emailPessoal = email;
  if (educationalEmail) where.emailEducacional = educationalEmail;
  if (name) where.nome = { contains: name, mode: "insensitive" as const };

  try {
    const users = await prisma.usuario.findMany({
      where,
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

    if (!users.length) {
      await res.code(404).send({ error: "Usuário não encontrado" });
      return;
    }

    await res.send(users);
  } catch (e) {
    req.log.error({ e }, "💥 Erro em /usuarios");
    await res.code(500).send({ error: errMsg(e) });
  }
};
