import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "crypto";

export const REFRESH_TOKEN_TTL_MS = parseTtlMs(process.env.JWT_REFRESH_EXPIRES) ?? 7 * 24 * 60 * 60 * 1000;

function parseTtlMs(v?: string): number | null {
  if (!v) return null;
  // aceita "7d", "15m", "3600" (s), etc.
  const m = /^(\d+)([smhd])?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateRefreshToken() {
  const token = randomBytes(48).toString("base64url");
  return { token };
}

type Tx = PrismaClient | Prisma.TransactionClient;

export async function createSessionWithClient(
  prisma: Tx,
  opts: { usuarioId: string; refreshToken: string; ip?: string; userAgent?: string; expiraEm: Date }
) {
  const refreshHash = sha256hex(opts.refreshToken);
  return prisma.sessao.create({
    data: {
      usuarioId: opts.usuarioId,
      refreshHash,
      userAgent: opts.userAgent,
      ip: opts.ip,
      expiraEm: opts.expiraEm,
      // ultimoUsoEm tem default(now()) no schema
    },
  });
}

export async function createSession(opts: {
  usuarioId: string;
  refreshToken: string;
  ip?: string;
  userAgent?: string;
  expiraEm: Date;
}) {
  // usa o prisma decorado no Fastify em runtime; aqui usamos um client isolado para util
  const prisma = new PrismaClient();
  try {
    return await createSessionWithClient(prisma, opts);
  } finally {
    await prisma.$disconnect();
  }
}

export async function verifyAndGetSession(refreshToken: string) {
  const prisma = new PrismaClient();
  try {
    const refreshHash = sha256hex(refreshToken);
    const sessao = await prisma.sessao.findFirst({
      where: {
        refreshHash,
        revogadaEm: null,
        expiraEm: { gt: new Date() },
      },
    });
    return sessao;
  } finally {
    await prisma.$disconnect();
  }
}

export async function rotateSession(sessaoId: string, novoRefreshToken: string) {
  const prisma = new PrismaClient();
  try {
    const novoHash = sha256hex(novoRefreshToken);
    await prisma.$transaction(async (tx: { sessao: { create: (arg0: { data: { usuarioId: any; refreshHash: string; expiraEm: Date; }; }) => any; findUniqueOrThrow: (arg0: { where: { id: string; }; }) => any; update: (arg0: { where: { id: string; }; data: { revogadaEm: Date; substituidaPorId: any; }; }) => any; }; }) => {
      const nova = await tx.sessao.create({
        data: {
          usuarioId: (await tx.sessao.findUniqueOrThrow({ where: { id: sessaoId } })).usuarioId,
          refreshHash: novoHash,
          expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });
      await tx.sessao.update({
        where: { id: sessaoId },
        data: { revogadaEm: new Date(), substituidaPorId: nova.id },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}
