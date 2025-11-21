import type { FastifyInstance } from "fastify";

export async function catalogoRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: [app.authenticate as any] }, // 🔐 rota privada
    async (req, res) => {
      const prisma = req.prisma; // ✔ usando o decorator do plugin

      try {
        const categorias = await prisma.categoria.findMany({
          include: {
            servicos: {
              where: { ativo: true },
              select: {
                id: true,
                nome: true,
                descricao: true,
                ativo: true,
                categoriaId: true,
              },
            },
          },
          orderBy: { nome: "asc" },
        });

        return res.code(200).send({ categorias });
      } catch (e: any) {
        req.log.error(e, "Erro ao carregar catálogo");
        return res.code(500).send({ error: "Erro ao carregar catálogo" });
      }
    }
  );
}
