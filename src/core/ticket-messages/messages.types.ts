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

/** Body do PATCH em lote: só existe "marcar como lidas" (lida: true), igual às notificações. */
export const MarkReadBodySchema = z.object({
  lida: z.literal(true, {
    errorMap: () => ({ message: "só é possível marcar como lidas (lida: true)" }),
  }),
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
export const MarkReadSchema = z.object({
  params: ParamsWithTicketIdSchema,
  body: MarkReadBodySchema,
});