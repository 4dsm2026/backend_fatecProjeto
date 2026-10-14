import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PaginationQuerySchema, buildLinks, link, path } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { zStringTrim, zEmail } from "../../utils/zod-helpers";

export const ComunicacaoChaveSchema = zStringTrim.min(1).max(64);

const MAX_TEXT_COLUMN_BYTES = 65_535;
const fitsTextColumn = (value: string): boolean => Buffer.byteLength(value, "utf8") <= MAX_TEXT_COLUMN_BYTES;

const nonEmptyTextColumn = (label: string) =>
  zStringTrim.min(1).refine(fitsTextColumn, { message: `${label} deve ter no máximo 65.535 bytes em UTF-8.` });

export const ComunicacaoListQuerySchema = PaginationQuerySchema;

export type ComunicacaoListQuery = z.infer<typeof ComunicacaoListQuerySchema>;

export type ComunicacaoTemplate = Prisma.ComunicacaoTemplateGetPayload<object>;

export interface ComunicacaoListResult {
  items: ComunicacaoTemplate[];
  total: number;
}

export function buildCommunicationTemplateLinks(template: Pick<ComunicacaoTemplate, "chave">, viewer: Viewer) {
  const href = path`/admin/communication-templates/${template.chave}`;
  const isAdmin = viewer.role === "ADMINISTRADOR";

  return buildLinks({
    self: link(href),
    collection: link("/admin/communication-templates"),
    update: isAdmin && link(href, "PUT"),
  });
}

export const ComunicacaoUpsertSchema = z.object({
  params: z.object({ chave: ComunicacaoChaveSchema }),
  body: z.object({
    nome: zStringTrim.min(1).max(160),
    descricao: zStringTrim.max(500).optional().nullable(),
    habilitado: z.boolean().optional().default(true),
    assunto: zStringTrim.min(1).max(500),
    corpo: nonEmptyTextColumn("Corpo"),
    variaveis: z.array(z.string()).optional(),
  }),
});

export const ComunicacaoTesteSchema = z.object({
  body: z.object({
    to: zEmail,
    assunto: zStringTrim.min(1).max(500),
    corpo: nonEmptyTextColumn("Corpo"),
  }),
});
