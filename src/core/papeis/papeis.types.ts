import type { Prisma } from "@prisma/client";
import { PaginationQuerySchema, buildLinks, link, path } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { z } from "zod";

export type PapelCreateBody = {
  nome: string;
  descricao?: string | null;
};

export type PapelUpdateBody = Partial<PapelCreateBody>;

export type PapelWithUsage = Prisma.PapelCatalogoGetPayload<{
  include: { _count: { select: { usuarioSetores: true } } };
}>;

export type PapelPublic = Pick<PapelWithUsage, "id" | "nome" | "descricao">;

export const PapeisListQuerySchema = PaginationQuerySchema;

export type PapeisListQuery = z.infer<typeof PapeisListQuerySchema>;

export interface PapelListResult {
  items: PapelWithUsage[];
  total: number;
}

export function buildPapelLinks(papel: Pick<PapelWithUsage, "id" | "_count">, viewer: Viewer) {
  const isAdmin = viewer.role === "ADMINISTRADOR";
  const href = path`/admin/roles/${papel.id}`;

  return buildLinks({
    self: link(href),
    collection: link("/admin/roles"),
    update: isAdmin && link(href, "PATCH"),
    delete: isAdmin && papel._count.usuarioSetores === 0 && link(href, "DELETE"),
  });
}
