// src/env.ts – Validação de variáveis de ambiente na inicialização
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3333),
  CORS_ORIGIN: z.string().default(""),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET é obrigatório"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET é obrigatório"),
  JWT_ACCESS_EXPIRES: z.string().default("15m"),
  JWT_REFRESH_EXPIRES: z.string().default("7d"),
  JWT_ISSUER: z.string().default("helpdesk"),
  JWT_AUDIENCE: z.string().default("helpdesk-app"),

  // Cookies
  COOKIE_SECRET: z.string().min(1).optional(),

  // Email (driver: "ses" | "resend")
  MAIL_DRIVER: z.enum(["ses", "resend"]).default("resend"),
  MAIL_FROM: z.string().default("Suporte <no-reply@workflowfatec.com.br>"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Suporte <no-reply@workflowfatec.com.br>"),

  // AWS SES (quando MAIL_DRIVER=ses)
  AWS_SES_REGION: z.string().optional(),
  AWS_SES_ACCESS_KEY_ID: z.string().optional(),
  AWS_SES_SECRET_ACCESS_KEY: z.string().optional(),

  // App
  APP_WEB_URL: z.string().url().optional(),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n❌ Variáveis de ambiente inválidas:\n${formatted}\n`);
    process.exit(1);
  }

  // Alertas para produção
  if (result.data.NODE_ENV === "production") {
    if (!result.data.COOKIE_SECRET) {
      console.warn("⚠️  COOKIE_SECRET não definido em produção – defina um segredo forte");
    }
    if (!result.data.APP_WEB_URL) {
      console.warn("⚠️  APP_WEB_URL não definido – links de reset de senha não funcionarão");
    }
    if (result.data.JWT_ACCESS_SECRET === "change-me") {
      console.error("❌ JWT_ACCESS_SECRET está com valor padrão em produção!");
      process.exit(1);
    }
  }

  return result.data;
}

export const env = validateEnv();
