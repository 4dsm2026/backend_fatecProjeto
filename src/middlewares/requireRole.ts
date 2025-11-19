import { FastifyRequest, FastifyReply } from "fastify";
import { Papel } from "@prisma/client";

// Exemplo de uso:
// app.get("/rota", { preHandler: [requireAuth, requireRole("GESTOR")] }, handler)

export function requireRole(...roles: Papel[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const usuario = (req as any).user;

    if (!usuario) {
      return reply.status(401).send({ message: "Usuário não autenticado" });
    }

    if (!roles.includes(usuario.papel)) {
      return reply
        .status(403)
        .send({ message: "Você não tem permissão para acessar esta rota" });
    }
  };
}
