// src/auth/jwt.ts
import jwt, { SignOptions, JwtPayload as JWTStd } from "jsonwebtoken";

export interface AccessClaims {
  sub: string;   // id do usuário
  email: string; // email principal
  role: string;  // ex.: "USUARIO" | "BACKOFFICE" | "TECNICO" | "ADMINISTRADOR"
}

export type AccessTokenPayload = JWTStd & AccessClaims;

const ACCESS_DEFAULT_EXPIRES: SignOptions["expiresIn"] =
  (process.env.JWT_ACCESS_EXPIRES as any) || "15m";

export function generateAccessToken(
  claims: AccessClaims,
  opts?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET não definido");

  const { sub, email, role } = claims;

  return jwt.sign(
    { sub, email, role },
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
