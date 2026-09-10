import type { FastifyReply } from "fastify";

export function sendReply(res: FastifyReply, statusCode: number, payload: unknown) {
  return res.code(statusCode).send(payload);
}

export function sendValidationError(res: FastifyReply, payload: unknown) {
  return sendReply(res, 400, payload);
}

export function sendUnauthorized(res: FastifyReply) {
  return sendReply(res, 401, { error: "Não autenticado" });
}

export function sendNotFound(res: FastifyReply, resource: string) {
  return sendReply(res, 404, { error: `${resource} não encontrado` });
}