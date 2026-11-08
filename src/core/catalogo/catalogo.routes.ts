import type { FastifyInstance } from "fastify";
import { toResource } from "../../hateoas";
import { buildCatalogLinks } from "./catalogo.hateoas";

export async function catalogoRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Catálogo"],
      summary: "Consultar o catálogo de serviços",
      description:
        "Retorna as categorias e serviços ativos. As categorias são conteúdo aninhado do recurso catálogo; " +
        "não há endpoints individuais para elas ou seus serviços.",
      security: [],
      response: {
        200: {
          type: "object",
          required: ["categorias", "_links"],
          properties: {
            categorias: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                  servicos: { type: "array", items: { type: "object", additionalProperties: true } },
                },
              },
            },
            _links: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  }, async (req, res) => {
    const categorias = await req.server.prisma.categoria.findMany({
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

    return res.status(200).send(
      toResource({ categorias }, buildCatalogLinks()),
    );
  });
}
