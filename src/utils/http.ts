import type { FastifyReply } from "fastify";

export function sendReply(res: FastifyReply, statusCode: number, payload: unknown) {
  return res.code(statusCode).send(payload);
}