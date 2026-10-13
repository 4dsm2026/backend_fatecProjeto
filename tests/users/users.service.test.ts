import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/hateoas";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import { createUser, getUserById, listUsers, softDeleteUser, updateUser } from "../../src/core/users/users.service";
import { userPublicSelect } from "../../src/core/users/users.types";
import type { UserResponse } from "../../src/types/users";

vi.mock("../../src/security/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed:password"),
}));

const fixedDate = new Date("2026-01-01T00:00:00.000Z");
const user: UserResponse = {
  id: "user-1",
  organizacaoId: null,
  nome: "Ana Silva",
  emailPessoal: "ana@example.com",
  emailEducacional: null,
  ra: "RA-1",
  cursoNome: "DSM",
  cursoSigla: "DSM",
  papel: "USUARIO",
  ativo: true,
  anonimizado: false,
  criadoEm: fixedDate,
  atualizadoEm: fixedDate,
  deletadoEm: null,
  unidadeFatec: null,
  curso: null,
  eixoTecnologico: null,
  turno: null,
  turma: null,
  semestreAtual: null,
  matrizCurricular: null,
  situacaoAcademica: null,
  anoSemestreIngresso: null,
  coordenadorCurso: null,
  telefoneCelular: null,
  whatsapp: null,
  canalPreferencialContato: null,
  melhorPeriodoContato: null,
  necessitaAtendimentoAcessivel: false,
  tipoAcessibilidade: null,
  observacoesAtendimento: null,
  notificacoesInApp: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.usuario.create.mockResolvedValue(user);
  prismaMock.usuario.findUnique.mockResolvedValue(user);
  prismaMock.usuario.findMany.mockResolvedValue([user]);
  prismaMock.usuario.update.mockResolvedValue(user);
  prismaMock.usuario.count.mockResolvedValue(1);
  prismaMock.auditoria.create.mockResolvedValue({});
});

describe("users service", () => {
  it("uses only the explicit public select and paginates from zero", async () => {
    await listUsers(prismaMock, { page: 2, size: 10, q: "Ana" });

    expect(prismaMock.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletadoEm: null,
          OR: expect.arrayContaining([
            { nome: { contains: "Ana" } },
            { emailPessoal: { contains: "Ana" } },
          ]),
        }),
        select: userPublicSelect,
        skip: 20,
        take: 10,
      }),
    );
    expect(userPublicSelect).not.toHaveProperty("senhaHash");
    expect(userPublicSelect).not.toHaveProperty("loginAttempts");
    expect(userPublicSelect).not.toHaveProperty("lockedUntil");
    expect(userPublicSelect).toHaveProperty("necessitaAtendimentoAcessivel");
    expect(userPublicSelect).toHaveProperty("observacoesAtendimento");
  });

  it("creates a user and returns the selected public projection", async () => {
    const created = await createUser(prismaMock, {
      nome: "Ana Silva",
      emailPessoal: "ana@example.com",
      senha: "StrongPassword123!",
      papel: "USUARIO",
      ativo: true,
    });

    expect(prismaMock.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senhaHash: "hashed:password", papel: "USUARIO" }),
        select: userPublicSelect,
      }),
    );
    expect(created).toEqual(user);
  });

  it("rejects missing name or both email addresses before writing", async () => {
    await expect(createUser(prismaMock, {
      emailPessoal: "ana@example.com",
      papel: "USUARIO",
      ativo: true,
    })).rejects.toMatchObject({ kind: "bad-request" });

    await expect(createUser(prismaMock, {
      nome: "Ana Silva",
      papel: "USUARIO",
      ativo: true,
    })).rejects.toMatchObject({ kind: "bad-request" });

    expect(prismaMock.usuario.create).not.toHaveBeenCalled();
  });

  it("requires the temporary password when create has no password", async () => {
    const originalPassword = process.env.DEFAULT_TEMP_PASSWORD;
    delete process.env.DEFAULT_TEMP_PASSWORD;
    try {
      await expect(createUser(prismaMock, {
        nome: "Ana Silva",
        emailPessoal: "ana@example.com",
        papel: "USUARIO",
        ativo: true,
      })).rejects.toThrow("DEFAULT_TEMP_PASSWORD é obrigatória");
    } finally {
      if (originalPassword === undefined) delete process.env.DEFAULT_TEMP_PASSWORD;
      else process.env.DEFAULT_TEMP_PASSWORD = originalPassword;
    }
    expect(prismaMock.usuario.create).not.toHaveBeenCalled();
  });

  it("uses educational email as the stored personal email and flags students", async () => {
    await createUser(prismaMock, {
      nome: "Ana Silva",
      emailEducacional: "ana@fatec.example",
      ra: "RA-1",
      papel: "USUARIO",
      ativo: true,
      senha: "StrongPassword123!",
    });

    expect(prismaMock.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailPessoal: "ana@fatec.example",
          emailEducacional: "ana@fatec.example",
          precisaTrocarSenha: true,
        }),
      }),
    );
  });

  it("fetches a user with the public select", async () => {
    const result = await getUserById(prismaMock, "user-1");

    expect(result).toEqual(user);
    expect(prismaMock.usuario.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: userPublicSelect,
    });
  });

  it("updates supplied fields and hashes a supplied password", async () => {
    await updateUser(prismaMock, "user-1", {
      nome: "Ana Atualizada",
      senha: "StrongPassword123!",
    });

    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ nome: "Ana Atualizada", senhaHash: "hashed:password" }),
        select: userPublicSelect,
      }),
    );
  });

  it("rejects updates to a removed user before persisting", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ ...user, ativo: false, deletadoEm: fixedDate });

    await expect(updateUser(prismaMock, "user-1", { ativo: true })).rejects.toMatchObject({ kind: "conflict" });
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("soft-deletes an existing user", async () => {
    const removed = { ...user, ativo: false, anonimizado: true, deletadoEm: fixedDate };
    prismaMock.usuario.update.mockResolvedValue(removed);

    const result = await softDeleteUser(prismaMock, "user-1");

    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ ativo: false, anonimizado: true, telefoneCelular: null }),
        select: userPublicSelect,
      }),
    );
    expect(result).toEqual(removed);
  });

  it("soft-deletes without inventing RA or educational email", async () => {
    const withoutAcademicIds = { ...user, ra: null, emailEducacional: null };
    prismaMock.usuario.findUnique.mockResolvedValue(withoutAcademicIds);
    prismaMock.usuario.update.mockResolvedValue(withoutAcademicIds);

    await softDeleteUser(prismaMock, "user-1");

    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ra: null, emailEducacional: null }),
      }),
    );
  });

  it("returns not-found when the user to soft-delete does not exist", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue(null);

    await expect(softDeleteUser(prismaMock, "missing-user")).rejects.toMatchObject({ kind: "not-found" });
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("returns conflict on repeated soft delete without updating again", async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({ ...user, deletadoEm: fixedDate });

    await expect(softDeleteUser(prismaMock, "user-1")).rejects.toBeInstanceOf(ApiError);
    await expect(softDeleteUser(prismaMock, "user-1")).rejects.toMatchObject({ kind: "conflict" });
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("continues the user operation if audit persistence fails", async () => {
    prismaMock.usuario.create.mockResolvedValue(user);
    prismaMock.auditoria.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(createUser(prismaMock, {
      nome: "Ana Silva",
      emailPessoal: "ana@example.com",
      senha: "StrongPassword123!",
      papel: "USUARIO",
      ativo: true,
    })).resolves.toEqual(user);
  });
});
