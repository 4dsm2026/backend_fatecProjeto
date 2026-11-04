import { z } from "zod";
import { zEmail, zStringTrim, zStrongPassword } from "../utils/zod-helpers";

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

export const EsqueciSenhaSchema = z.object({
  email: zEmail,
});

/** `PUT /password-resets/:token`: o token sai do corpo e vai para o path. */
export const RedefinirSenhaBodySchema = z.object({ novaSenha: zStrongPassword });
export const PasswordResetParamsSchema = z.object({ token: z.string().min(1) });

/** `PUT /account-activations/:token`: o token vai no caminho; senha e e-mail (opcional) no corpo. */
export const AtivarContaBodySchema = z.object({
  novaSenha: zStrongPassword,
  emailPessoal: zEmail.optional(),
});
export const AccountActivationParamsSchema = z.object({ token: z.string().min(1) });

export const TrocarSenhaSchema = z.object({
  senhaAtual: zStringTrim.min(1, "Informe a senha atual"),
  novaSenha: zStrongPassword,
});
