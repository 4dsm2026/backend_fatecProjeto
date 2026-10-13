import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/hateoas";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import { createUser, listUsers, softDeleteUser, updateUser } from "../../src/core/users/users.service";
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
