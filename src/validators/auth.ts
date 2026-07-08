import { z } from "zod";
import { zEmail, zStringTrim, zPapelOptional } from "../utils/zod-helpers";

export const zRA = zStringTrim
  .min(3, "RA muito curto")
  .max(32, "RA muito longo")
  .regex(/^[A-Za-z0-9._-]+$/, "RA deve conter apenas letras, números, ponto, underline ou hífen");

export const LoginSchema = z
  .object({
    email: zEmail.optional(),
    ra: zRA.optional(),
    password: zStringTrim.min(8, "Senha deve ter ao menos 8 caracteres"),
  })
  .refine((data) => !!data.email !== !!data.ra, {
    path: ["email"],
    message: "Informe e-mail institucional (funcionário) OU RA (aluno)",
  });

export const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const RegisterSchema = z.object({
  email: zEmail,
  password: zStringTrim.min(8),
  role: zPapelOptional,
  name: zStringTrim.min(2, "Nome muito curto"),
  educationalEmail: zEmail.optional(),
  ra: zRA.optional(),
});

export const FirstAccessBodySchema = z.object({
  token: zStringTrim.min(10, "Token inválido"),
  newPassword: zStringTrim
    .min(8, "Mínimo de 8 caracteres")
    .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula")
    .regex(/[a-z]/, "Inclua ao menos uma letra minúscula")
    .regex(/\d/, "Inclua ao menos um número")
    .regex(/[^A-Za-z0-9]/, "Inclua ao menos um símbolo"),
  personalEmail: zEmail.optional(),
});

export const EsqueciSenhaSchema = z.object({
  email: zEmail,
});

export const ResetSenhaSchema = z.object({
  token: zStringTrim.min(10),
  newPassword: zStringTrim.min(8),
});

export const FirstAccessSchema = FirstAccessBodySchema;

export const TrocarSenhaSchema = z.object({
  senhaAtual: zStringTrim.min(1, "Informe a senha atual"),
  novaSenha: zStringTrim
    .min(8, "Mínimo de 8 caracteres")
    .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula")
    .regex(/[a-z]/, "Inclua ao menos uma letra minúscula")
    .regex(/\d/, "Inclua ao menos um número")
    .regex(/[^A-Za-z0-9]/, "Inclua ao menos um símbolo"),
});
