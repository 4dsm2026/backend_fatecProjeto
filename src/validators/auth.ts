import { z } from "zod";
import { zEmail, zPassword, zPapelOptional } from "../utils/zod-helpers";

/** Auth */
export const LoginSchema = z.object({
  email: zEmail,
  password: zPassword,
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(20, "Refresh token inválido"),
});

export const RegisterSchema = z.object({
  email: zEmail,                       // email pessoal
  password: zPassword,
  role: zPapelOptional,                // mapeia string -> enum Papel (default USUARIO)
  name: z.string().trim().min(2),
  educationalEmail: zEmail.optional(), // email educacional
  ra: z.string().trim().max(32).optional(),
});
