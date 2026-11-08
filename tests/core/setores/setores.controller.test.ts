import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildSectorLinks } from "../../../src/core/setores/setores.hateoas.js";
import {
  create,
  getOne,
  list,
  patch,
  removeHard,
} from "../../../src/core/setores/setores.controller.js";
import { ApiError } from "../../../src/hateoas/problem.js";

function createMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

const sampleSector = {
  id: "sec-1",
  nome: "Suporte Técnico",
  descricao: "Atende chamados de TI",
  organizacaoId: null,
};

describe("setores.hateoas — Links por Papel", () => {
  it("ADMINISTRADOR recebe self, collection, update, delete e users", () => {
    const links = buildSectorLinks(sampleSector, {
      id: "u-admin",
      role: "ADMINISTRADOR",
    });

    expect(links.self).toEqual({ href: "/admin/sectors/sec-1", method: "GET" });
    expect(links.collection).toEqual({ href: "/admin/sectors", method: "GET" });
    expect(links.update).toEqual({
      href: "/admin/sectors/sec-1",
      method: "PATCH",
    });
    expect(links.delete).toEqual({
      href: "/admin/sectors/sec-1",
      method: "DELETE",
    });
    expect(links.users).toEqual({
      href: "/admin/sectors/sec-1/users",
      method: "GET",
    });
  });

  it("TECNICO (staff) recebe self, collection e users, mas NÃO recebe update nem delete", () => {
    const links = buildSectorLinks(sampleSector, {
      id: "u-tech",
      role: "TECNICO",
    });

    expect(links.self).toBeDefined();
    expect(links.collection).toBeDefined();
    expect(links.users).toBeDefined();
    expect(links.update).toBeUndefined();
    expect(links.delete).toBeUndefined();
  });

  it("USUARIO comum recebe apenas self e collection (sem update, delete ou users)", () => {
    const links = buildSectorLinks(sampleSector, {
      id: "u-aluno",
      role: "USUARIO",
    });

    expect(links.self).toBeDefined();
    expect(links.collection).toBeDefined();
    expect(links.update).toBeUndefined();
    expect(links.delete).toBeUndefined();
    expect(links.users).toBeUndefined();
  });
});

describe("setores.controller", () => {
  it("POST /admin/sectors retorna 201 Created, header Location e recurso HAL", async () => {
    const req = {
      user: { id: "u-admin", role: "ADMINISTRADOR" },
      body: { nome: "Suporte Técnico", descricao: "Atende chamados de TI" },
      server: {
        prisma: {
          setor: {
            create: vi.fn().mockResolvedValue(sampleSector),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await create(req, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.header).toHaveBeenCalledWith(
      "Location",
      "/admin/sectors/sec-1"
    );
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sec-1",
        _links: expect.objectContaining({
          self: { href: "/admin/sectors/sec-1", method: "GET" },
          update: { href: "/admin/sectors/sec-1", method: "PATCH" },
          delete: { href: "/admin/sectors/sec-1", method: "DELETE" },
        }),
      })
    );
  });

  it("GET /admin/sectors retorna coleção HAL com _embedded.sectors, page base 0 e link create", async () => {
    const req = {
      user: { id: "u-admin", role: "ADMINISTRADOR" },
      query: { page: "0", size: "20" },
      server: {
        prisma: {
          setor: {
            findMany: vi.fn().mockResolvedValue([sampleSector]),
            count: vi.fn().mockResolvedValue(1),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await list(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        _embedded: {
          sectors: [expect.objectContaining({ id: "sec-1" })],
        },
        page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
        _links: expect.objectContaining({
          self: { href: "/admin/sectors?page=0&size=20", method: "GET" },
          create: { href: "/admin/sectors", method: "POST" },
        }),
      })
    );
  });

  it("GET /admin/sectors/:id lança ApiError 404 quando o setor não existe", async () => {
    const req = {
      user: { id: "u-admin", role: "ADMINISTRADOR" },
      params: { id: "inexistente" },
      server: {
        prisma: {
          setor: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await expect(getOne(req, reply)).rejects.toThrowError(ApiError);
  });

  it("PATCH /admin/sectors/:id retorna 200 com recurso HAL atualizado", async () => {
    const updated = { ...sampleSector, nome: "Suporte N2" };
    const req = {
      user: { id: "u-admin", role: "ADMINISTRADOR" },
      params: { id: "sec-1" },
      body: { nome: "Suporte N2" },
      server: {
        prisma: {
          setor: {
            findUnique: vi.fn().mockResolvedValue(sampleSector),
            update: vi.fn().mockResolvedValue(updated),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await patch(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sec-1",
        nome: "Suporte N2",
        _links: expect.objectContaining({
          self: { href: "/admin/sectors/sec-1", method: "GET" },
        }),
      })
    );
  });

  it("DELETE /admin/sectors/:id retorna 204 No Content sem corpo", async () => {
    const req = {
      user: { id: "u-admin", role: "ADMINISTRADOR" },
      params: { id: "sec-1" },
      server: {
        prisma: {
          setor: {
            findUnique: vi.fn().mockResolvedValue(sampleSector),
            delete: vi.fn().mockResolvedValue(sampleSector),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await removeHard(req, reply);

    expect(reply.code).toHaveBeenCalledWith(204);
    expect(reply.send).toHaveBeenCalledWith();
  });
});