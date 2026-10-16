import { describe, expect, it, vi } from "vitest";
import { AuditoriaController } from "../../../src/core/auditoria/auditoria.controller";

const admin = { id: "admin-1", role: "ADMINISTRADOR" };

describe("AuditoriaController", () => {
  it("devolve a lista como coleção HAL paginada com links", async () => {
    const logs = [{ id: "log-1", feitoPorId: "user-1", acao: "LOGIN_SUCESSO" }];
    const service = { listar: vi.fn().mockResolvedValue({ total: 1, items: logs }) };
    const controller = new AuditoriaController(service as never);
    const request = {
      query: { page: "0", size: "20", userId: "user-1" },
      user: admin,
    } as never;
    const reply = { send: vi.fn() } as never;

    await controller.listar(request, reply);

    expect(service.listar).toHaveBeenCalledWith({
      page: 0,
      size: 20,
      userId: "user-1",
    });
    expect(reply.send).toHaveBeenCalledWith({
      _embedded: {
        "audit-logs": [
          {
            ...logs[0],
            _links: {
              collection: { href: "/admin/audit-logs", method: "GET" },
              actor: { href: "/usuarios/user-1", method: "GET" },
            },
          },
        ],
      },
      page: { size: 20, number: 0, totalElements: 1, totalPages: 1 },
      _links: {
        self: { href: "/admin/audit-logs?page=0&size=20&userId=user-1", method: "GET" },
        first: { href: "/admin/audit-logs?page=0&size=20&userId=user-1", method: "GET" },
        last: { href: "/admin/audit-logs?page=0&size=20&userId=user-1", method: "GET" },
        create: { href: "/admin/audit-logs", method: "POST" },
      },
    });
  });

  it("devolve o registro criado como recurso com links", async () => {
    const log = { id: "log-1", feitoPorId: null };
    const service = { registrar: vi.fn().mockResolvedValue(log) };
    const controller = new AuditoriaController(service as never);
    const request = { body: { acao: "LOGIN_SUCESSO" }, user: admin } as never;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await controller.registrar(request, reply);

    expect(service.registrar).toHaveBeenCalledWith(request.body);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({
      ...log,
      _links: { collection: { href: "/admin/audit-logs", method: "GET" } },
    });
  });

  it("rejeita query inválida em vez de montar uma coleção incorreta", async () => {
    const service = { listar: vi.fn() };
    const controller = new AuditoriaController(service as never);
    const request = {
      query: { page: "-1", size: "20" },
      user: admin,
    } as never;

    await expect(controller.listar(request, { send: vi.fn() } as never)).rejects.toThrow();
    expect(service.listar).not.toHaveBeenCalled();
  });
});
