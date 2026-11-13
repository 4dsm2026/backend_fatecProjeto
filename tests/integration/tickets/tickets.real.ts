import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { registerTicketScenarios } from "./ticket-scenarios";
import { registerJ1 } from "../journeys/j1-ticket-lifecycle";
import type { PrepareTicketFixtures } from "./fixtures";

let container: StartedMySqlContainer | undefined;
let app: FastifyInstance | undefined;
let prisma: PrismaClient;
let baseUrl: string;
let databaseUrl: string;
let storageDir: string | undefined;
let passwordHash: string;
const password = `teste-${randomBytes(24).toString("base64url")}A1!`;

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "workflow-tickets-"));
  // 8.0.39 é a versão do compose atual; a migração para 8.4 será validada pela equipe.
  container = await new MySqlContainer("mysql:8.0.39")
    .withDatabase("workflow_tickets_test")
    .withUsername("ticket_test")
    .withUserPassword(randomBytes(18).toString("hex"))
    .withRootPassword(randomBytes(18).toString("hex"))
    .start();
  databaseUrl = container.getConnectionUri();

  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    COOKIE_SECRET: randomBytes(32).toString("hex"),
    DEFAULT_TEMP_PASSWORD: password,
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: storageDir,
    MAIL_DRIVER: "resend",
    RESEND_API_KEY: "test-only",
    // Qualquer envio inesperado deve falhar localmente, sem acessar serviços externos.
    RESEND_BASE_URL: "http://127.0.0.1:9",
  });

  const prismaCli = resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 120_000,
  });

  // Estes imports só acontecem depois que DATABASE_URL e os segredos foram definidos.
  const [{ buildApp }, prismaModule] = await Promise.all([
    import("../../../src/app"),
    import("../../../src/lib/prisma"),
  ]);
  prisma = prismaModule.prisma;
  passwordHash = await argon2.hash(password);
  app = await buildApp();
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      await container?.stop();
    } finally {
      // Nenhum cenário de chamados grava anexos; falhar é melhor que apagar uma pasta inesperada.
      if (storageDir) await rmdir(storageDir);
    }
  }
});

async function login(email: string): Promise<{ accessToken: string }> {
  const response = await fetch(new URL("/sessions", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 201) throw new Error(`Login falhou: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ accessToken: string }>;
}

const prepare: PrepareTicketFixtures = async () => {
  // Não permite limpar ou criar dados se a URL deixou de ser a do container desta execução.
  if (process.env.DATABASE_URL !== databaseUrl) throw new Error("Banco de teste inesperado");
  // Limpa dados dinâmicos em ordem de dependência, sem tocar nas migrations.
  await prisma.$transaction([
    prisma.notificacao.deleteMany(),
    prisma.emailEnvio.deleteMany(),
    prisma.anexo.deleteMany(),
    prisma.mensagem.deleteMany(),
    prisma.historicoStatusChamado.deleteMany(),
    prisma.chamadoTag.deleteMany(),
    prisma.auditoria.deleteMany(),
    prisma.chamado.deleteMany(),
    prisma.tokenResetSenha.deleteMany(),
    prisma.loginTentativa.deleteMany(),
    prisma.sessao.deleteMany(),
    prisma.usuarioSetor.deleteMany(),
    prisma.usuario.deleteMany(),
    prisma.setor.deleteMany(),
  ]);
  const suffix = randomBytes(8).toString("hex");
  const sector = await prisma.setor.create({ data: { nome: `Secretaria ${suffix}` } });
  const makeUser = (role: "USUARIO" | "TECNICO" | "BACKOFFICE" | "ADMINISTRADOR", name: string) =>
    prisma.usuario.create({ data: {
      nome: name,
      emailPessoal: `${name.toLowerCase()}-${suffix}@example.test`,
      senhaHash: passwordHash,
      papel: role,
      precisaTrocarSenha: false,
    } });
  const [student, other, staff, backofficeUser, admin] = await Promise.all([
    makeUser("USUARIO", "Aluno"), makeUser("USUARIO", "Outro"),
    makeUser("TECNICO", "Funcionario"), makeUser("BACKOFFICE", "Backoffice"),
    makeUser("ADMINISTRADOR", "Admin"),
  ]);
  await prisma.usuarioSetor.create({ data: { usuarioId: staff.id, setorId: sector.id } });
  const [aluno, outroAluno, funcionario, backoffice, administrador] = await Promise.all([
    login(student.emailPessoal), login(other.emailPessoal),
    login(staff.emailPessoal), login(backofficeUser.emailPessoal), login(admin.emailPessoal),
  ]);
  return {
    ctx: { baseUrl }, aluno, outroAluno,
    funcionario: { ...funcionario, userId: staff.id },
    backoffice,
    admin: administrador,
    setorId: sector.id,
    async setEncerradoEm(ticketId, date) {
      await prisma.chamado.update({ where: { id: ticketId }, data: { encerradoEm: date } });
    },
  };
};

registerTicketScenarios(prepare);
registerJ1(prepare);
