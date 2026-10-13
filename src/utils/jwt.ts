// src/utils/jwt.ts
import jwt, { SignOptions, JwtPayload as JWTStd } from "jsonwebtoken";

export interface AccessClaims {
  sub: string;   // id do usuário
  email: string; // email principal
  role: string;  // ex.: "USUARIO" | "BACKOFFICE" | "TECNICO" | "ADMINISTRADOR"
  /**
   * Id da `Sessao` (refresh) que originou este access token; é o que permite
   * `DELETE /sessions/current` achar a sessão. O id é estável na rotação
   * (`rotateSession` troca só o hash). Opcional no tipo porque tokens emitidos
   * antes desta claim existir não a têm; quem emite sessões novas SEMPRE a envia.
   */
  sid?: string;
}

export type AccessTokenPayload = JWTStd & AccessClaims;

export interface RefreshClaims {
  sub: string;   // id do usuário
}

export type RefreshTokenPayload = JWTStd & RefreshClaims;

const ACCESS_DEFAULT_EXPIRES = (process.env.JWT_ACCESS_EXPIRES ||
  "15m") as SignOptions["expiresIn"];

const REFRESH_DEFAULT_EXPIRES = (process.env.JWT_REFRESH_EXPIRES ||
  "7d") as SignOptions["expiresIn"];

export function generateAccessToken(
  claims: AccessClaims,
  opts?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

  const { sub, email, role, sid } = claims;

  return jwt.sign(
    { sub, email, role, ...(sid ? { sid } : {}) },
    secret,
    {
      algorithm: "HS256",
      expiresIn: opts?.expiresIn ?? ACCESS_DEFAULT_EXPIRES,
      issuer: process.env.JWT_ISSUER || "helpdesk",
      audience: process.env.JWT_AUDIENCE || "helpdesk-app",
    }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

  try {
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: process.env.JWT_ISSUER || "helpdesk",
      audience: process.env.JWT_AUDIENCE || "helpdesk-app",
      clockTolerance: 5, // segundos de tolerância
    }) as AccessTokenPayload;
  } catch {
    throw new Error("Token inválido ou expirado");
  }
}

export function generateRefreshToken(
  claims: RefreshClaims,
  opts?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET ou JWT_ACCESS_SECRET não definido");

  const { sub } = claims;

  return jwt.sign(
    { sub },
    secret,
    {
      algorithm: "HS256",
      expiresIn: opts?.expiresIn ?? REFRESH_DEFAULT_EXPIRES,
      issuer: process.env.JWT_ISSUER || "helpdesk",
      audience: process.env.JWT_AUDIENCE || "helpdesk-app",
    }
  );
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET ou JWT_ACCESS_SECRET não definido");

  try {
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: process.env.JWT_ISSUER || "helpdesk",
      audience: process.env.JWT_AUDIENCE || "helpdesk-app",
      clockTolerance: 5,
    }) as RefreshTokenPayload;
  } catch {
    throw new Error("Token inválido ou expirado");
  }
}

export interface DownloadTokenPayload {
  sub: string; // user id
  anexoId: string;
  purpose: 'DOWNLOAD';
  iat?: number;
  exp?: number;
}

/**
 * Audience própria do token de download, DERIVADA da audience da aplicação.
 * Antes era `JWT_AUDIENCE || 'helpdesk-download'`: como `JWT_AUDIENCE` sempre
 * existe (env.ts tem default), os dois tipos de token ficavam com a mesma
 * audience e o mesmo segredo, e um era aceito no lugar do outro.
 */
function downloadAudience(): string {
  return `${process.env.JWT_AUDIENCE || 'helpdesk-app'}:download`;
}

export function generateDownloadToken(
  payload: { sub: string; anexoId: string },
  opts?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

  return jwt.sign(
    { sub: payload.sub, anexoId: payload.anexoId, purpose: 'DOWNLOAD' },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: opts?.expiresIn ?? '5m',
      issuer: process.env.JWT_ISSUER || 'helpdesk',
      audience: downloadAudience(),
    }
  );
}

export function verifyDownloadToken(token: string): DownloadTokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'helpdesk',
      audience: downloadAudience(),
      clockTolerance: 5,
    }) as DownloadTokenPayload;

    // Defesa em profundidade além da audience: o conteúdo precisa ser mesmo de download.
    if (payload.purpose !== 'DOWNLOAD' || typeof payload.anexoId !== 'string') {
      throw new Error('purpose inválido');
    }
    return payload;
  } catch {
    throw new Error('Token inválido ou expirado');
  }
}
