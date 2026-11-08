import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPapel, deletePapel, listPapeis, updatePapel } from "../../../src/core/papeis/papeis.service";

const prismaMock = {
  papelCatalogo: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  usuarioSetor: {
    count: vi.fn(),
  },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("papeis service", () => {
  it("paginates the catalog and includes relation counts in the item query", async () => {
    const items = [{
      id: "role-1",
      nome: "Coordenador",
      descricao: null,
      _count: { usuarioSetores: 0 },
    }];
    vi.mocked(prismaMock.papelCatalogo.findMany).mockResolvedValue(items);
    vi.mocked(prismaMock.papelCatalogo.count).mockResolvedValue(1);

    const result = await listPapeis(prismaMock, { page: 2, size: 10 });

    expect(result).toEqual({ items, total: 1 });
    expect(prismaMock.papelCatalogo.findMany).toHaveBeenCalledWith({
      orderBy: { nome: "asc" },
      skip: 20,
      take: 10,
      include: { _count: { select: { usuarioSetores: true } } },
    });
    expect(prismaMock.papelCatalogo.count).toHaveBeenCalledWith();
  });

  it("conditionally deletes an unlinked role in one deleteMany operation", async () => {
    vi.mocked(prismaMock.papelCatalogo.deleteMany).mockResolvedValue({ count: 1 });

    await deletePapel(prismaMock, "role-1");

    expect(prismaMock.papelCatalogo.deleteMany).toHaveBeenCalledWith({
      where: { id: "role-1", usuarioSetores: { none: {} } },
    });
    expect(prismaMock.papelCatalogo.findUnique).not.toHaveBeenCalled();
  });

  it("returns conflict when conditional delete finds a linked role", async () => {
    vi.mocked(prismaMock.papelCatalogo.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prismaMock.papelCatalogo.findUnique).mockResolvedValue({ id: "role-1" });

    await expect(deletePapel(prismaMock, "role-1")).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });

    expect(prismaMock.papelCatalogo.deleteMany).toHaveBeenCalledWith({
      where: { id: "role-1", usuarioSetores: { none: {} } },
    });
    expect(prismaMock.papelCatalogo.findUnique).toHaveBeenCalledWith({
      where: { id: "role-1" },
      select: { id: true },
    });
  });

  it("returns not-found when conditional delete matches no existing role", async () => {
    vi.mocked(prismaMock.papelCatalogo.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prismaMock.papelCatalogo.findUnique).mockResolvedValue(null);

    await expect(deletePapel(prismaMock, "role-1")).rejects.toMatchObject({
      kind: "not-found",
      status: 404,
    });
  });

  it("maps duplicate role names on create and update to conflict", async () => {
    vi.mocked(prismaMock.papelCatalogo.create).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    vi.mocked(prismaMock.papelCatalogo.update).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(createPapel(prismaMock, { nome: "Duplicado" })).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    await expect(updatePapel(prismaMock, "role-1", { nome: "Duplicado" })).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
  });
});