import { z } from "zod";
import { PaginationQuerySchema } from "../../hateoas";

/** Params :id de ticket */
export const ParamsWithTicketIdSchema = z.object({
  id: z.string().min(1),
});

/** Params :id de ticket + :messageId */
export const ParamsWithMessageIdSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
});

/** Body para criação de mensagem */
export const CreateMessageBodySchema = z.object({
  conteudo: z.string().min(1, "conteudo é obrigatório"),
});

/** Query da listagem: paginação padrão do núcleo (page a partir de 0, size) + ordenação */
export const ListMessagesQuerySchema = PaginationQuerySchema.extend({
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateMessageBody = z.infer<typeof CreateMessageBodySchema>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

/** Wrappers p/ parseOrThrow */
export const CreateMessageSchema = z.object({
  params: ParamsWithTicketIdSchema,
  body: CreateMessageBodySchema,
});
export const ListMessagesSchema = z.object({
  params: ParamsWithTicketIdSchema,
  query: ListMessagesQuerySchema,
});
export const GetMessageSchema = z.object({
  params: ParamsWithMessageIdSchema,
});