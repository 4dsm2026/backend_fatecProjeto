import { z } from "zod";

const pag = {
  page: z.coerce.number().int().min(1).default(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).default(20).optional(),
};

const zId = z.string().min(1);

export const VincularUsuarioSetorSchema = z.object({
  params: z.object({ usuarioId: zId }),
  body: z.object({
    setorId: zId,
    papelId: zId.optional().nullable(),
  }),
});

export const AlterarPapelUsuarioSetorSchema = z.object({
  params: z.object({ usuarioSetorId: zId }),
  body: z.object({
    papelId: zId.optional().nullable(),
  }),
});

export const ListUsuariosDoSetorSchema = z.object({
  params: z.object({ setorId: zId }),
  query: z.object({
    ...pag,
    search: z.string().min(1).optional(),
  }),
});

export const ListSetoresDoUsuarioSchema = z.object({
  params: z.object({ usuarioId: zId }),
  query: z.object({ ...pag }),
});
