import { z } from "zod";

/** Enums como unions de string (evita depender da geração do client) */
export const TipoNotificacaoZ = z.enum([
  "CHAMADO_CRIADO",
  "CHAMADO_ATRIBUIDO",
  "CHAMADO_ATUALIZADO",
  "STATUS_ALTERADO",
  "MENSAGEM_NOVA",
  "ANEXO_NOVO",
  "SISTEMA",
]);
export type TipoNotificacao = z.infer<typeof TipoNotificacaoZ>;

export const CanalNotificacaoZ = z.enum(["IN_APP", "EMAIL", "PUSH"]);
export type CanalNotificacao = z.infer<typeof CanalNotificacaoZ>;

/** Query de listagem */
export const NotificationsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),

  apenasNaoLidas: z.coerce.boolean().default(false),
  tipo: TipoNotificacaoZ.optional(),
  canal: CanalNotificacaoZ.optional(),

  /** datas ISO opcionais */
  criadoDe: z.string().optional(),
  criadoAte: z.string().optional(),

  search: z.string().optional(),
  orderBy: z.enum(["criadoEm"]).default("criadoEm"),
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});
export type NotificationsListQuery = z.infer<typeof NotificationsListQuerySchema>;

/** Params :id */
export const ParamsWithIdSchema = z.object({ id: z.string().min(1) });

/** Wrappers p/ buildRouteValidator */
export const NotificationsListSchema = z.object({ query: NotificationsListQuerySchema });
export const NotificationIdSchema   = z.object({ params: ParamsWithIdSchema });
