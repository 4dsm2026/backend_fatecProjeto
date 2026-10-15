import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  alterarPapelNoSetor,
  desvincularUsuarioSetor,
  listarSetoresDoUsuario,
  listarUsuariosDoSetor,
  vincularUsuarioSetor,
} from "../../../src/core/usuario-setor/usuarioSetor.service.js";
import { normalizeError } from "../../../src/hateoas/problem.js";

function createMockPrisma() {
  return {
    usuarioSetor: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("usuarioSetor.service", () => {
  it("cria vínculo entre usuário e setor", async () => {
    const prisma = createMockPrisma();
    const vinculo = {
      id: "us-1",
      usuarioId: "u-1",
      setorId: "s-1",
      papelId: "p-1",
    };
    vi.mocked(prisma.usuarioSetor.create).mockResolvedValue(vinculo as never);

    const result = await vincularUsuarioSetor(prisma, {
      usuarioId: "u-1",
      setorId: "s-1",
      papelId: "p-1",
    });

    expect(result).toEqual(vinculo);
  });

  it("propaga erro P2002 em vínculo duplicado para ser normalizado como 409 Conflict", async () => {
    const prisma = createMockPrisma();
    const duplicateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    vi.mocked(prisma.usuarioSetor.create).mockRejectedValue(duplicateError);

    await expect(
      vincularUsuarioSetor(prisma, {
        usuarioId: "u-1",
        setorId: "s-1",
        papelId: "p-1",
      })
    ).rejects.toThrow();

    const apiErr = normalizeError(duplicateError);
    expect(apiErr.status).toBe(409);
    expect(apiErr.type).toBe("/errors/conflict");
  });

  it("lista setores de um usuário com paginação base 0", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.usuarioSetor.findMany).mockResolvedValue([]);
    vi.mocked(prisma.usuarioSetor.count).mockResolvedValue(0);

    await listarSetoresDoUsuario(prisma, "u-1", { page: 0, size: 20 });

    expect(prisma.usuarioSetor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuarioId: "u-1" },
        skip: 0,
        take: 20,
      })
    );
  });

  it("lista usuários de um setor com paginação base 0", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.usuarioSetor.findMany).mockResolvedValue([]);
    vi.mocked(prisma.usuarioSetor.count).mockResolvedValue(0);

    await listarUsuariosDoSetor(prisma, "s-1", { page: 1, size: 15 });

    expect(prisma.usuarioSetor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { setorId: "s-1" },
        skip: 15,
        take: 15,
      })
    );
  });

  it("altera papel do usuário no setor", async () => {
    const prisma = createMockPrisma();
    const updated = {
      id: "us-1",
      usuarioId: "u-1",
      setorId: "s-1",
      papelId: "p-2",
    };
    vi.mocked(prisma.usuarioSetor.update).mockResolvedValue(updated as never);

    const res = await alterarPapelNoSetor(prisma, "us-1", { papelId: "p-2" });
    expect(res.papelId).toBe("p-2");
  });

  it("desvincula usuário do setor", async () => {
    const prisma = createMockPrisma();
    vi.mocked(prisma.usuarioSetor.delete).mockResolvedValue({
      id: "us-1",
    } as never);

    await desvincularUsuarioSetor(prisma, "us-1");
    expect(prisma.usuarioSetor.delete).toHaveBeenCalledWith({
      where: { id: "us-1" },
    });
  });
});