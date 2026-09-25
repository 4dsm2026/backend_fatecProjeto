// src/security/refresh.ts
import { prisma } from "../lib/prisma";
import { randomBytes, createHash } from "node:crypto";

export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

/**
 * SHA-256 determinístico para lookup O(1) no banco.
 * Argon2 é intencionalmentente lento e não deve ser usado para tokens
 * de sessão (que não são senhas) — causava scan full-table de sessões.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken() {
  const token = randomBytes(64).toString("base64url");
  return { token };
}

export async function createSession({
  usuarioId,
  refreshToken,
  ip,
  userAgent,
  expiraEm,
}: {
  usuarioId: string;
  refreshToken: string;
  ip?: string;
  userAgent?: string;
  expiraEm: Date;
}) {
  const refreshHash = hashToken(refreshToken);
  return prisma.sessao.create({
    data: { usuarioId, refreshHash, ip, userAgent, expiraEm },
  });
}

export async function createSessionWithClient(
  tx: any,
  args: {
    usuarioId: string;
    refreshToken: string;
    ip?: string;
    userAgent?: string;
    expiraEm: Date;
  },
) {
  const refreshHash = hashToken(args.refreshToken);
  return tx.sessao.create({
    data: {
      usuarioId: args.usuarioId,
      refreshHash,
      ip: args.ip,
      userAgent: args.userAgent,
      expiraEm: args.expiraEm,
    },
  });
}

/** Lookup O(1) via índice no banco — sem scan nem Argon2. */
export async function verifyAndGetSession(refreshToken: string) {
  const refreshHash = hashToken(refreshToken);
  return prisma.sessao.findFirst({
    where: { refreshHash, revogadaEm: null },
  });
}

export async function rotateSession(sessaoId: string, novoRefreshToken: string) {
  const novoHash = hashToken(novoRefreshToken);
  return prisma.sessao.update({
    where: { id: sessaoId },
    data: { refreshHash: novoHash, ultimoUsoEm: new Date() },
  });
}
