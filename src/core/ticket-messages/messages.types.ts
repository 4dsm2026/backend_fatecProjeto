import { z } from "zod";

/** Params :id de ticket */
export const ParamsWithTicketIdSchema = z.object({
  id: z.string().min(1),
});

/** Body para criação de mensagem */
export const CreateMessageBodySchema = z.object({
  conteudo: z.string().min(1, "conteudo é obrigatório"),
});

/** Query para listagem */
export const ListMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateMessageBody = z.infer<typeof CreateMessageBodySchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

/** Wrappers p/ buildRouteValidator */
export const CreateMessageSchema = z.object({
  params: ParamsWithTicketIdSchema,
  body: CreateMessageBodySchema,
});
export const ListMessagesSchema = z.object({
  params: ParamsWithTicketIdSchema,
  query: ListMessagesQuerySchema,
});
