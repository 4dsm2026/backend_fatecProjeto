import { createHash } from "node:crypto";

/**
 * Hash deterministico SHA-256 para valores não-senhas (tokens, lookup keys).
 * Não use para senhas — use src/security/password.ts (Argon2).
 */
export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyHash(value: string, hash: string): boolean {
  return hashValue(value) === hash;
}
