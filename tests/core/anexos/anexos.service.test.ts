import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";

const {
  mockPrisma,
  mockMkdir,
  mockWriteFile,
  mockUnlink,
  mockAccess,
} = vi.hoisted(() => ({
  mockPrisma: {
    chamado: { findFirst: vi.fn() },
    anexo: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    usuarioSetor: { findFirst: vi.fn() },
  },
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockUnlink: vi.fn(),
  mockAccess: vi.fn(),
}));

vi.mock("../../../src/core/notifications/notify", () => ({
  notifyMany: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    unlink: mockUnlink,
    access: mockAccess,
  },
}));

import * as AnexosService from "../../../src/core/anexos/anexos.service";

afterEach(() => {
  vi.resetAllMocks();
});

const prisma = mockPrisma as unknown as PrismaClient;
const viewer = { id: "owner-1", role: "USUARIO" as const };

function openTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: "ticket-1",
    protocolo: "TCK-1",
    criadoPorId: viewer.id,
    responsavelId: null,
    organizacaoId: null,
    status: "ABERTO",
    encerradoEm: null,
    arquivadoEm: null,
    ...overrides,
  };
}

function request(file: unknown): FastifyRequest {
  return {
    file: vi.fn().mockResolvedValue(file),
  } as unknown as FastifyRequest;
}

function uploadedFile(overrides: Record<string, unknown> = {}) {
  return {
    filename: "documento.pdf",
    mimetype: "application/pdf",
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("conteudo")),
    ...overrides,
  };
}

const storedAttachment = {
  id: "cmj1234567890123456789012",
  chamadoId: "ticket-1",
  caminhoArquivo: "stored-file.pdf",
  nomeArquivo: "documento.pdf",
  mimeType: "application/pdf",
  tamanhoBytes: 9,
  enviadoEm: new Date("2026-01-01T00:00:00.000Z"),
  enviadoPorId: viewer.id,
  enviadoPor: { id: viewer.id, nome: "Usuário" },
  downloadAllowed: true,
  chamado: { criadoPorId: viewer.id, responsavelId: null, setorId: null },
};

describe("attachments service", () => {
  it("counts and paginates attachments without returning internal file paths", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce({
      id: "ticket-1",
      criadoPorId: viewer.id,
      responsavelId: null,
      setorId: null,
    });
    mockPrisma.anexo.count.mockResolvedValueOnce(21);
    mockPrisma.anexo.findMany.mockResolvedValueOnce([{
      id: "attachment-1",
      enviadoPorId: "uploader",
    }]);

    const result = await AnexosService.listAnexosByTicketId(prisma, "ticket-1", 2, 10, viewer);

    expect(result).toEqual({
      items: [{ id: "attachment-1", enviadoPorId: "uploader", downloadAllowed: true }],
      total: 21,
    });
    expect(mockPrisma.anexo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { chamadoId: "ticket-1" },
      skip: 20,
      take: 10,
    }));
    expect(mockPrisma.anexo.findMany).toHaveBeenCalledWith(expect.not.objectContaining({
      select: expect.objectContaining({ caminhoArquivo: true }),
    }));
  });

  it("returns not-found for a missing ticket", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(null);

    await expect(
      AnexosService.listAnexosByTicketId(prisma, "missing", 0, 20, viewer),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
    expect(mockPrisma.anexo.findMany).not.toHaveBeenCalled();
  });

  it("denies listing attachments from another user's ticket", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce({
      id: "ticket-1",
      criadoPorId: "other-user",
      responsavelId: null,
      setorId: null,
    });

    await expect(
      AnexosService.listAnexosByTicketId(prisma, "ticket-1", 0, 20, viewer),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
    expect(mockPrisma.anexo.count).not.toHaveBeenCalled();
    expect(mockPrisma.anexo.findMany).not.toHaveBeenCalled();
  });

  it("propagates unexpected list failures for RFC 7807 handling", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce({
      id: "ticket-1",
      criadoPorId: viewer.id,
      responsavelId: null,
      setorId: null,
    });
    const databaseError = new Error("database unavailable");
    mockPrisma.anexo.count.mockRejectedValueOnce(databaseError);

    await expect(
      AnexosService.listAnexosByTicketId(prisma, "ticket-1", 1, 5, viewer),
    ).rejects.toBe(databaseError);
  });

  it("checks the shared ticket interaction rule before accepting an upload", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket({
      status: "ENCERRADO",
      encerradoEm: new Date(),
    }));
    const req = request(uploadedFile());

    await expect(
      AnexosService.createAnexo(prisma, req, "ticket-1", viewer),
    ).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(req.file).not.toHaveBeenCalled();
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
  });

  it("rejects an upload without a file", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());
    const req = request(undefined);

    await expect(
      AnexosService.createAnexo(prisma, req, "ticket-1", viewer),
    ).rejects.toMatchObject({ kind: "bad-request", status: 400 });
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it.each([
    ["archived", { arquivadoEm: new Date("2026-01-01T00:00:00.000Z") }],
    ["resolved", { status: "RESOLVIDO", encerradoEm: new Date("2026-01-01T00:00:00.000Z") }],
    ["closed", { status: "ENCERRADO", encerradoEm: new Date("2026-01-01T00:00:00.000Z") }],
  ] as const)("rejects an upload in a %s ticket", async (_state, ticketOverrides) => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket(ticketOverrides));
    const req = request(uploadedFile());

    await expect(
      AnexosService.createAnexo(prisma, req, "ticket-1", viewer),
    ).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(req.file).not.toHaveBeenCalled();
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
  });

  it("hides another user's ticket as not-found", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket({ criadoPorId: "other-user" }));

    await expect(
      AnexosService.createAnexo(prisma, request(uploadedFile()), "ticket-1", viewer),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("rejects unsupported MIME types without persisting an attachment", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());

    await expect(
      AnexosService.createAnexo(
        prisma,
        request(uploadedFile({ mimetype: "application/x-msdownload" })),
        "ticket-1",
        viewer,
      ),
    ).rejects.toMatchObject({ kind: "unsupported-media-type", status: 415 });
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
  });

  it("rejects files larger than 10 MB", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());

    await expect(
      AnexosService.createAnexo(
        prisma,
        request(uploadedFile({
          toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(10 * 1024 * 1024 + 1)),
        })),
        "ticket-1",
        viewer,
      ),
    ).rejects.toMatchObject({ kind: "payload-too-large", status: 413 });
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
  });

  it("removes a partially written file when disk persistence fails", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());
    const diskError = new Error("disk full");
    mockWriteFile.mockRejectedValueOnce(diskError);

    await expect(
      AnexosService.createAnexo(prisma, request(uploadedFile()), "ticket-1", viewer),
    ).rejects.toBe(diskError);
    expect(mockUnlink).toHaveBeenCalledOnce();
    expect(mockPrisma.anexo.create).not.toHaveBeenCalled();
  });

  it("stores an allowed upload and attributes it to the authenticated viewer", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());
    const result = { id: storedAttachment.id, nomeArquivo: "documento.pdf" };
    mockPrisma.anexo.create.mockResolvedValueOnce(result);

    await expect(
      AnexosService.createAnexo(prisma, request(uploadedFile()), "ticket-1", viewer),
    ).resolves.toEqual(result);
    expect(mockPrisma.anexo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        chamadoId: "ticket-1",
        enviadoPorId: viewer.id,
        mimeType: "application/pdf",
      }),
    }));
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it("removes the stored file when creating the database record fails", async () => {
    mockPrisma.chamado.findFirst.mockResolvedValueOnce(openTicket());
    const databaseError = new Error("database unavailable");
    mockPrisma.anexo.create.mockRejectedValueOnce(databaseError);

    await expect(
      AnexosService.createAnexo(prisma, request(uploadedFile()), "ticket-1", viewer),
    ).rejects.toBe(databaseError);
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it("returns only metadata from the authorized attachment record", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce(storedAttachment);

    await expect(
      AnexosService.getAnexoMetadata(prisma, storedAttachment.id, viewer.id, viewer.role),
    ).resolves.toEqual({
      id: storedAttachment.id,
      chamadoId: storedAttachment.chamadoId,
      nomeArquivo: storedAttachment.nomeArquivo,
      mimeType: storedAttachment.mimeType,
      tamanhoBytes: storedAttachment.tamanhoBytes,
      enviadoEm: storedAttachment.enviadoEm,
      enviadoPor: storedAttachment.enviadoPor,
      downloadAllowed: true,
    });
  });

  it("preserves download authorization and rejects path traversal", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce({
      ...storedAttachment,
      caminhoArquivo: "..\\outside.pdf",
    });
    await expect(
      AnexosService.getAnexoForDownload(prisma, storedAttachment.id, viewer.id, viewer.role),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it.each(["ADMINISTRADOR", "BACKOFFICE"] as const)(
    "allows %s to download an attachment",
    async (role) => {
      mockPrisma.anexo.findUnique.mockResolvedValueOnce(storedAttachment);
      mockAccess.mockResolvedValueOnce(undefined);

      await expect(
        AnexosService.getAnexoForDownload(prisma, storedAttachment.id, "staff-1", role),
      ).resolves.toMatchObject({
        fileName: storedAttachment.nomeArquivo,
        mimeType: storedAttachment.mimeType,
      });
      expect(mockAccess).toHaveBeenCalledOnce();
    },
  );

  it("returns not-found when the requested attachment does not exist", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce(null);

    await expect(
      AnexosService.getAnexoMetadata(prisma, "missing", viewer.id, viewer.role),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("returns not-found when downloading a nonexistent attachment", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce(null);

    await expect(
      AnexosService.getAnexoForDownload(prisma, "missing", viewer.id, viewer.role),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("propagates unexpected failures during download", async () => {
    const databaseError = new Error("database unavailable");
    mockPrisma.anexo.findUnique.mockRejectedValueOnce(databaseError);

    await expect(
      AnexosService.getAnexoForDownload(prisma, storedAttachment.id, viewer.id, viewer.role),
    ).rejects.toBe(databaseError);
  });

  it("maps a missing physical file to RFC 7807 not-found", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce(storedAttachment);
    mockAccess.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(
      AnexosService.getAnexoForDownload(prisma, storedAttachment.id, viewer.id, viewer.role),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("denies users without a relationship to the ticket or attachment", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce({
      ...storedAttachment,
      enviadoPorId: "uploader",
      chamado: { criadoPorId: "owner", responsavelId: null, setorId: null },
    });

    await expect(
      AnexosService.getAnexoMetadata(prisma, storedAttachment.id, "stranger", "USUARIO"),
    ).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("does not grant a technician download access without an attachment relationship", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce({
      ...storedAttachment,
      enviadoPorId: "uploader",
      chamado: { criadoPorId: "owner", responsavelId: null, setorId: null },
    });

    await expect(
      AnexosService.getAnexoForDownload(
        prisma,
        storedAttachment.id,
        "technician",
        "TECNICO",
      ),
    ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
  });

  it("denies a user without a relationship from downloading an attachment", async () => {
    mockPrisma.anexo.findUnique.mockResolvedValueOnce({
      ...storedAttachment,
      enviadoPorId: "uploader",
      chamado: { criadoPorId: "owner", responsavelId: null, setorId: null },
    });

    await expect(
      AnexosService.getAnexoForDownload(
        prisma,
        storedAttachment.id,
        "stranger",
        "USUARIO",
      ),
    ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
