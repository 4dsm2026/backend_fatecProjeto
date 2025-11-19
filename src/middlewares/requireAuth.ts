import { FastifyRequest, FastifyReply } from "fastify";

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // Verifica se existe o token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.status(401).send({ message: "Token não enviado" });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verifica a assinatura usando o plugin do Fastify-JWT
    const decoded = await req.jwtVerify();

    // Salva no request para outros handlers/middlewares
    (req as any).user = decoded;

  } catch (error) {
    return reply.status(401).send({ message: "Token inválido" });
  }
}
