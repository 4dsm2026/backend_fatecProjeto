/**
 * Schemas OpenAPI do formato HAL. Ficam num lugar só: as rotas os usam direto e o
 * `plugins/swagger.ts` os registra em `components.schemas` (`Link` e `PageInfo`).
 * Espelham os tipos de `types.ts`.
 */

export const LinkSchema = {
  type: "object",
  required: ["href"],
  description: "Um link HAL: o endereço e o verbo HTTP que a ação usa.",
  properties: {
    href: { type: "string", example: "/tickets/clx1" },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      example: "GET",
      description: "Verbo HTTP. Ausente quando é `GET`.",
    },
    title: { type: "string", description: "Rótulo legível da ação." },
    name: {
      type: "string",
      description: "Distingue vários links do mesmo `rel` (ex.: o status de destino de `transition`).",
    },
  },
} as const;

export const HalLinksSchema = {
  type: "object",
  description:
    "Links HAL: cada chave (`self`, `reply`, `transition`...) tem um `Link` ou uma lista de `Link`. " +
    "Só aparece o que o usuário pode fazer naquele momento.",
  additionalProperties: {
    oneOf: [LinkSchema, { type: "array", items: LinkSchema }],
  },
} as const;

export const PageInfoSchema = {
  type: "object",
  description: "Dados da paginação (a primeira página é a 0).",
  required: ["size", "number", "totalElements", "totalPages"],
  properties: {
    size: { type: "integer", description: "Itens por página.", example: 20 },
    number: { type: "integer", description: "Página atual, a partir de 0.", example: 0 },
    totalElements: { type: "integer", description: "Total de itens que correspondem aos filtros.", example: 87 },
    totalPages: { type: "integer", description: "Total de páginas.", example: 5 },
  },
} as const;
