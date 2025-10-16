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

/* ============ LOGIN ============ */
const loginValidator = buildRouteValidator({ body: LoginSchema });
export const login = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const parsed = loginValidator.parse(req);
  if ("error" in parsed) {
    await res.code(400).send(parsed.error);
    return;
  }

  const prisma = (req.server as any).prisma;
  const { email, password } = parsed.data!.body! as { email: string; password: string };
  const ip = req.ip;
  const userAgent = String(req.headers["user-agent"] || "");

  try {
    const user = await prisma.usuario.findUnique({ where: { emailPessoal: email } });
    if (!user || !user.senhaHash || !(await verifyPassword(user.senhaHash, password))) {
      await prisma.loginTentativa.create({
        data: { email, usuarioId: user?.id ?? null, sucesso: false, ip, userAgent, motivo: "credenciais_invalidas" },
      });
      await res.code(401).send({ error: "Credenciais inválidas" });
      return;
    }
    if (!user.ativo) {
      await prisma.loginTentativa.create({
        data: { email, usuarioId: user.id, sucesso: false, ip, userAgent, motivo: "usuario_inativo" },
      });
      await res.code(403).send({ error: "Usuário inativo" });
      return;
    }

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
      data: { email, usuarioId: user.id, sucesso: true, ip, userAgent, motivo: "ok" },
    });

    await res.send({ user, accessToken, refreshToken });
  } catch (e) {
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
    const result = await prisma.$transaction(async (tx: {
        usuario: {
          findUnique: (arg0: { where: { emailPessoal: string; }; select: { id: boolean; }; }) => any; create: (arg0: {
            data: {
              nome: string; emailPessoal: string; emailEducacional: string | null; ra: string | null; senhaHash: string; papel: any; // normalizado via Zod
              ativo: boolean;
            };
          }) => any;
        };
      }) => {
      const exists = await tx.usuario.findUnique({ where: { emailPessoal: email }, select: { id: true } });
      if (exists) {
        const err: any = new Error("Email já está em uso");
        err.statusCode = 409;
        throw err;
      }

      const senhaHash = await hashPassword(password);

      const user = await tx.usuario.create({
        data: {
          nome: name,
          emailPessoal: email,
          emailEducacional: educationalEmail ?? null,
          ra: ra ?? null,
          senhaHash,
          papel: role, // normalizado via Zod
          ativo: true,
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
    if (e?.statusCode === 409 || e?.code === "P2002") {
      await res.code(409).send({ error: "Email já está em uso" });
      return;
    }
    await res.code(500).send({ error: "Erro ao criar o usuário", details: errMsg(e) });
  }
};

/* ============ REFRESH ============ */
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

    const user = await prisma.usuario.findUniqueOrThrow({ where: { id: sessao.usuarioId } });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.emailPessoal ?? "",
      role: user.papel,
    });

    const { token: novoRefresh } = genRT();
    await rotateSession(sessao.id, novoRefresh);

    await res.send({ accessToken, refreshToken: novoRefresh });
  } catch (e) {
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
    await res.code(500).send({ error: errMsg(e) });
  }
};

/* ============ ME ============ */
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
    const users = await prisma.usuario.findMany({ where });
    if (!users.length) {
      await res.code(404).send({ error: "Usuário não encontrado" });
      return;
    }
    await res.send(users);
  } catch (e) {
    await res.code(500).send({ error: errMsg(e) });
  }
};
