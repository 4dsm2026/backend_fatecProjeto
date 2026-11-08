import { z } from "zod";

const zId = z.string().min(1);

export const VincularUsuarioSetorSchema = z.object({
  params: z.object({
    id: zId.optional(),
    usuarioId: zId.optional(),
  }).refine((p) => Boolean(p.id || p.usuarioId), { message: "id ou usuarioId obrigatório" }),
  body: z.object({
    setorId: zId,
    papelId: zId.optional().nullable(),
  }),
});

export const AlterarPapelUsuarioSetorSchema = z.object({
  params: z.object({
    id: zId.optional(),
    usuarioSetorId: zId.optional(),
  }).refine((p) => Boolean(p.id || p.usuarioSetorId), { message: "id ou usuarioSetorId obrigatório" }),
  body: z.object({
    papelId: zId.optional().nullable(),
  }),
});

export const ListUsuariosDoSetorSchema = z.object({
  params: z.object({
    id: zId.optional(),
    setorId: zId.optional(),
  }).refine((p) => Boolean(p.id || p.setorId), { message: "id ou setorId obrigatório" }),
  query: z.object({
    page: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(100).optional(),
    perPage: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().min(1).optional(),
  }),
});

export const ListSetoresDoUsuarioSchema = z.object({
  params: z.object({
    id: zId.optional(),
    usuarioId: zId.optional(),
  }).refine((p) => Boolean(p.id || p.usuarioId), { message: "id ou usuarioId obrigatório" }),
  query: z.object({
    page: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(100).optional(),
    perPage: z.coerce.number().int().min(1).max(100).optional(),
  }),
});
