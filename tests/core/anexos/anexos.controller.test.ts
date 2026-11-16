import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

const {
  mockListAnexosByTicketId,
  mockAlunoSemAcessoAoChamado,
  mockCreateAnexo,
  mockGetAnexoForDownload,
  mockGetAnexoMetadata,
  mockCreateReadStream,
} = vi.hoisted(() => ({
  mockListAnexosByTicketId: vi.fn(),
  mockAlunoSemAcessoAoChamado: vi.fn(),
  mockCreateAnexo: vi.fn(),
  mockGetAnexoForDownload: vi.fn(),
  mockGetAnexoMetadata: vi.fn(),
  mockCreateReadStream: vi.fn(),
}));

vi.mock("../../../src/core/anexos/anexos.service", () => ({
  listAnexosByTicketId: mockListAnexosByTicketId,
  createAnexo: mockCreateAnexo,
  getAnexoForDownload: mockGetAnexoForDownload,
  getAnexoMetadata: mockGetAnexoMetadata,
}));

vi.mock("../../../src/core/tickets/tickets.service", () => ({
  alunoSemAcessoAoChamado: mockAlunoSemAcessoAoChamado,
}));

vi.mock("node:fs", () => ({
  default: { createReadStream: mockCreateReadStream },
  createReadStream: mockCreateReadStream,
}));

import * as AnexosController from "../../../src/core/anexos/anexos.controller";

afterEach(() => {
  vi.resetAllMocks();
});

const anexo = {
  id: "cmj1234567890123456789012",
  chamadoId: "ticket-1",
  enviadoPorId: "user-1",
  downloadAllowed: true,
  nomeArquivo: "documento.pdf",
  mimeType: "application/pdf",
  tamanhoBytes: 1024,
  enviadoEm: new Date("2026-01-01T00:00:00.000Z"),
  enviadoPor: { id: "user-1", nome: "Usuário" },
};

function request(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    params: { id: "ticket-1" },
    query: { page: "0", size: "20" },
    user: { sub: "user-1", role: "USUARIO" },
    server: { prisma: {} },
    log: { error: vi.fn() },
    ...overrides,
  } as unknown as FastifyRequest;
}

function reply(): FastifyReply {
  return {
    header: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe("attachments controller", () => {
  it("returns a paginated HAL collection with item navigation links", async () => {
    mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false);
    mockListAnexosByTicketId.mockResolvedValueOnce({ items: [anexo], total: 5 });
    const response = reply();

    await AnexosController.list(
      request({ query: { page: "1", size: "2" } }),
      response,
    );

    expect(mockListAnexosByTicketId).toHaveBeenCalledWith(
      {},
      "ticket-1",
      1,
      2,
      { id: "user-1", role: "USUARIO" },
    );
    expect(response.send).toHaveBeenCalledWith({
      _embedded: {
        attachments: [{
          id: anexo.id,
          nomeArquivo: anexo.nomeArquivo,
          mimeType: anexo.mimeType,
          tamanhoBytes: anexo.tamanhoBytes,
          enviadoEm: anexo.enviadoEm,
          enviadoPor: anexo.enviadoPor,
          _links: {
            self: { href: `/attachments/${anexo.id}`, method: "GET" },
            content: { href: `/attachments/${anexo.id}/content`, method: "GET" },
            collection: { href: "/tickets/ticket-1/attachments", method: "GET" },
          },
        }],
      },
      page: { size: 2, number: 1, totalElements: 5, totalPages: 3 },
      _links: {
        self: { href: "/tickets/ticket-1/attachments?page=1&size=2", method: "GET" },
        first: { href: "/tickets/ticket-1/attachments?page=0&size=2", method: "GET" },
        last: { href: "/tickets/ticket-1/attachments?page=2&size=2", method: "GET" },
        prev: { href: "/tickets/ticket-1/attachments?page=0&size=2", method: "GET" },
        next: { href: "/tickets/ticket-1/attachments?page=2&size=2", method: "GET" },
        ticket: { href: "/tickets/ticket-1", method: "GET" },
      },
    });
  });

  it("does not list attachments when anti-IDOR denies access", async () => {
    mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(true);

    await expect(
      AnexosController.list(request(), reply()),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
    expect(mockListAnexosByTicketId).not.toHaveBeenCalled();
  });

  it("omits a download link when the viewer cannot download that attachment", async () => {
    mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false);
    mockListAnexosByTicketId.mockResolvedValueOnce({
      items: [{ ...anexo, downloadAllowed: false }],
      total: 1,
    });
    const response = reply();

    await AnexosController.list(request(), response);

    const sent = vi.mocked(response.send).mock.calls[0][0] as {
      _embedded: { attachments: Array<{ _links: Record<string, unknown> }> };
    };
    expect(sent._embedded.attachments[0]._links).not.toHaveProperty("content");
  });

  it("rejects invalid pagination through the shared RFC 7807 error path", async () => {
    await expect(
      AnexosController.list(
        request({ query: { page: "-1", size: "101" } }),
        reply(),
      ),
    ).rejects.toMatchObject({ kind: "bad-request", status: 400 });
    expect(mockListAnexosByTicketId).not.toHaveBeenCalled();
  });

  it("returns 201, Location, and a HAL resource after upload", async () => {
    mockAlunoSemAcessoAoChamado.mockResolvedValueOnce(false);
    mockCreateAnexo.mockResolvedValueOnce(anexo);
    const response = reply();

    await AnexosController.upload(request(), response);

    expect(mockCreateAnexo).toHaveBeenCalledWith(
      {},
      expect.anything(),
      "ticket-1",
      { id: "user-1", role: "USUARIO" },
    );
    expect(response.header).toHaveBeenCalledWith("Location", `/attachments/${anexo.id}`);
    expect(response.code).toHaveBeenCalledWith(201);
    expect(response.send).toHaveBeenCalledWith({
      id: anexo.id,
      nomeArquivo: anexo.nomeArquivo,
      mimeType: anexo.mimeType,
      tamanhoBytes: anexo.tamanhoBytes,
      enviadoEm: anexo.enviadoEm,
      enviadoPor: anexo.enviadoPor,
      _links: {
        self: { href: `/attachments/${anexo.id}`, method: "GET" },
        content: { href: `/attachments/${anexo.id}/content`, method: "GET" },
        collection: { href: "/tickets/ticket-1/attachments", method: "GET" },
      },
    });
  });

  it("returns only public metadata with resource links", async () => {
    mockGetAnexoMetadata.mockResolvedValueOnce(anexo);
    const response = reply();

    await AnexosController.getOne(
      request({ params: { anexoId: anexo.id } }),
      response,
    );

    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({
      id: anexo.id,
      _links: {
        self: { href: `/attachments/${anexo.id}`, method: "GET" },
        content: { href: `/attachments/${anexo.id}/content`, method: "GET" },
        collection: { href: "/tickets/ticket-1/attachments", method: "GET" },
      },
    }));
    expect(response.send).not.toHaveBeenCalledWith(expect.objectContaining({
      chamadoId: "ticket-1",
    }));
  });

  it("streams content with a safe ASCII fallback and RFC 5987 filename", async () => {
    const stream = { stream: true };
    mockGetAnexoForDownload.mockResolvedValueOnce({
      filePath: "C:\\uploads\\doc.pdf",
      fileName: "relatório (1).pdf",
      mimeType: "application/pdf",
    });
    mockCreateReadStream.mockReturnValueOnce(stream);
    const response = reply();

    await AnexosController.download(
      request({ params: { anexoId: anexo.id } }),
      response,
    );

    expect(response.header).toHaveBeenNthCalledWith(
      1,
      "Content-Disposition",
      "attachment; filename=\"relat_rio (1).pdf\"; filename*=UTF-8''relat%C3%B3rio%20%281%29.pdf",
    );
    expect(response.header).toHaveBeenNthCalledWith(2, "Content-Type", "application/pdf");
    expect(response.send).toHaveBeenCalledWith(stream);
  });
});
