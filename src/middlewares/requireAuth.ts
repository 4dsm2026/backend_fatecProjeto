import { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../utils/jwt";

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
) {
  // Verifica se existe o token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return reply.status(401).send({ message: "Token não enviado" });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({ message: "Formato de token inválido" });
  }

  // Extrai o token
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return reply.status(401).send({ message: "Token inválido" });
  }

  try {
    // Verifica a assinatura usando a função verifyAccessToken
    const decoded = verifyAccessToken(token);

    // Salva no request para outros handlers/middlewares
    req.user = decoded;
  } catch (err: any) {
    return reply.status(401).send({ 
      message: "Token inválido ou expirado",
      details: err?.message
    });
  }
}