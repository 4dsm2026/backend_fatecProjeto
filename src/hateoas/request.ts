import type { FastifyRequest } from "fastify";
import type { ZodTypeAny, z } from "zod";
import { ApiError, fieldErrorsFromZod } from "./problem";
import type { Role, Viewer } from "./types";

/**
 * Extrai quem está fazendo a requisição (para filtrar links por papel).
 * Aceita tanto `{ id }` quanto `{ sub }` (payload do JWT). Sem usuário, retorna `undefined`.
 */
export function viewerFrom(req: FastifyRequest): Viewer | undefined {
  const user = (req as { user?: { id?: string; sub?: string; role?: Role } }).user;
  const id = user?.id ?? user?.sub;
  if (!id || !user?.role) return undefined;
  return { id, role: user.role };
}

/** Valida com zod; em caso de falha lança `ApiError` 400 com os erros por campo. */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, fieldErrorsFromZod(result.error.issues));
  }
  return result.data;
}

