import { z } from "zod";
import { PaginationQuerySchema } from "../../hateoas/pagination.js";

export const BooleanStringSchema = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const ListNotificationsQuerySchema = PaginationQuerySchema.extend({
  apenasNaoLidas: BooleanStringSchema,
  arquivadas: BooleanStringSchema,
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export const NotificationIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const PatchNotificationBodySchema = z
  .object({
    lida: z.boolean().optional(),
    arquivada: z.boolean().optional(),
  })
  .refine((data) => data.lida !== undefined || data.arquivada !== undefined, {
    message: "Informe ao menos 'lida' ou 'arquivada'",
  });

export type PatchNotificationBody = z.infer<typeof PatchNotificationBodySchema>;

export const PatchAllNotificationsBodySchema = z.object({
  lida: z.literal(true),
});

export type PatchAllNotificationsBody = z.infer<typeof PatchAllNotificationsBodySchema>;