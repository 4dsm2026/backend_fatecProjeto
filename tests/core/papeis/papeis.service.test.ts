import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePapel, listPapeis } from "../../../src/core/papeis/papeis.service";

const prismaMock = {
  papelCatalogo: {
    findMany: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
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

  it("deletes when no usuario-setor relation uses the role", async () => {
    vi.mocked(prismaMock.usuarioSetor.count).mockResolvedValue(0);
    vi.mocked(prismaMock.papelCatalogo.delete).mockResolvedValue({
      id: "role-1",
      nome: "Coordenador",
      descricao: null,
    });

    await deletePapel(prismaMock, "role-1");

    expect(prismaMock.usuarioSetor.count).toHaveBeenCalledWith({ where: { papelId: "role-1" } });
    expect(prismaMock.papelCatalogo.delete).toHaveBeenCalledWith({ where: { id: "role-1" } });
  });

  it("raises an RFC 7807 conflict and does not delete a linked role", async () => {
    vi.mocked(prismaMock.usuarioSetor.count).mockResolvedValue(1);

    await expect(deletePapel(prismaMock, "role-1")).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });

    expect(prismaMock.papelCatalogo.delete).not.toHaveBeenCalled();
  });

  it("maps a foreign-key race during delete to conflict", async () => {
    vi.mocked(prismaMock.usuarioSetor.count).mockResolvedValue(0);
    vi.mocked(prismaMock.papelCatalogo.delete).mockRejectedValue(
      Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }),
    );

    await expect(deletePapel(prismaMock, "role-1")).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
    expect(prismaMock.papelCatalogo.delete).toHaveBeenCalledWith({ where: { id: "role-1" } });
  });
});