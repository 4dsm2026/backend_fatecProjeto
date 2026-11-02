import { z } from 'zod';
import { PaginationQuerySchema } from '../../hateoas';

export const ParamsWithTicketIdSchema = z.object({
  id: z.string().min(1),
});

export const ParamsWithAnexoIdSchema = z.object({
  anexoId: z.string().cuid(), 
});

export const TicketIdParamsSchema = z.object({ params: ParamsWithTicketIdSchema });
export const AnexoIdParamsSchema = z.object({ params: ParamsWithAnexoIdSchema });
export const ListAnexosQuerySchema = z.object({
  query: PaginationQuerySchema,
});