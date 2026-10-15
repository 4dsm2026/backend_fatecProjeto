import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildUserSectorLinks } from "../../../src/core/usuario-setor/usuarioSetor.hateoas.js";
import {
  alterarPapel,
  desvincular,
  listSetoresDoUsuario,
  listUsuariosDoSetor,
  vincular,
} from "../../../src/core/usuario-setor/usuarioSetor.controller.js";

function createMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

const sampleVinculo = {
  id: "us-1",
  usuarioId: "u-1",
  setorId: "s-1",
  papelId: "p-1",
};

describe("usuarioSetor.hateoas — Links por Papel", () => {
  it("ADMINISTRADOR e TECNICO recebem links de update e delete do vínculo", () => {
    const adminLinks = buildUserSectorLinks(sampleVinculo, {
      id: "adm-1",
      role: "ADMINISTRADOR",
    });

    expect(adminLinks.self).toEqual({
      href: "/admin/user-sectors/us-1",
      method: "GET",
    });
    expect(adminLinks.update).toEqual({
      href: "/admin/user-sectors/us-1",
      method: "PATCH",
    });
    expect(adminLinks.delete).toEqual({
      href: "/admin/user-sectors/us-1",
      method: "DELETE",
    });
  });

  it("USUARIO comum não recebe links de mutação (update/delete)", () => {
    const userLinks = buildUserSectorLinks(sampleVinculo, {
      id: "usr-1",
      role: "USUARIO",
    });

    expect(userLinks.self).toBeDefined();
    expect(userLinks.update).toBeUndefined();
    expect(userLinks.delete).toBeUndefined();
  });
});

describe("usuarioSetor.controller", () => {
  it("POST /admin/users/:id/sectors retorna 201 Created com Location /admin/user-sectors/:id", async () => {
    const req = {
      user: { id: "adm-1", role: "ADMINISTRADOR" },
      params: { id: "u-1" },
      body: { setorId: "s-1", papelId: "p-1" },
      server: {
        prisma: {
          usuarioSetor: {
            create: vi.fn().mockResolvedValue(sampleVinculo),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await vincular(req, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.header).toHaveBeenCalledWith(
      "Location",
      "/admin/user-sectors/us-1"
    );
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "us-1",
        _links: expect.objectContaining({
          self: { href: "/admin/user-sectors/us-1", method: "GET" },
        }),
      })
    );
  });

  it("GET /admin/users/:id/sectors retorna coleção HAL paginada", async () => {
    const req = {
      user: { id: "adm-1", role: "ADMINISTRADOR" },
      params: { id: "u-1" },
      query: { page: "0", size: "20" },
      server: {
        prisma: {
          usuarioSetor: {
            findMany: vi.fn().mockResolvedValue([sampleVinculo]),
            count: vi.fn().mockResolvedValue(1),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await listSetoresDoUsuario(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
        _links: expect.objectContaining({
          self: {
            href: "/admin/users/u-1/sectors?page=0&size=20",
            method: "GET",
          },
        }),
      })
    );
  });

  it("GET /admin/sectors/:id/users retorna coleção HAL paginada", async () => {
    const req = {
      user: { id: "adm-1", role: "ADMINISTRADOR" },
      params: { id: "s-1" },
      query: { page: "0", size: "20" },
      server: {
        prisma: {
          usuarioSetor: {
            findMany: vi.fn().mockResolvedValue([sampleVinculo]),
            count: vi.fn().mockResolvedValue(1),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await listUsuariosDoSetor(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
        _links: expect.objectContaining({
          self: {
            href: "/admin/sectors/s-1/users?page=0&size=20",
            method: "GET",
          },
        }),
      })
    );
  });

  it("PATCH /admin/user-sectors/:id altera papel e retorna recurso HAL", async () => {
    const updated = { ...sampleVinculo, papelId: "p-novo" };
    const req = {
      user: { id: "adm-1", role: "ADMINISTRADOR" },
      params: { id: "us-1" },
      body: { papelId: "p-novo" },
      server: {
        prisma: {
          usuarioSetor: {
            update: vi.fn().mockResolvedValue(updated),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await alterarPapel(req, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "us-1",
        papelId: "p-novo",
        _links: expect.objectContaining({
          self: { href: "/admin/user-sectors/us-1", method: "GET" },
        }),
      })
    );
  });

  it("DELETE /admin/user-sectors/:id retorna 204 No Content sem corpo", async () => {
    const req = {
      user: { id: "adm-1", role: "ADMINISTRADOR" },
      params: { id: "us-1" },
      server: {
        prisma: {
          usuarioSetor: {
            delete: vi.fn().mockResolvedValue(sampleVinculo),
          },
        },
      },
    } as unknown as FastifyRequest;
    const reply = createMockReply();

    await desvincular(req, reply);

    expect(reply.code).toHaveBeenCalledWith(204);
    expect(reply.send).toHaveBeenCalledWith();
  });
});