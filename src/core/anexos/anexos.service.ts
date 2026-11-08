import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ApiError, toSkipTake } from "../../hateoas";
import type { Role, Viewer } from "../../hateoas";
import { canInteractWithTicket, canViewTicket } from "../tickets/ticket-rules";
import type { TicketContext } from "../tickets/ticket-rules";
import { notifyMany } from "../notifications/notify";

type Ctx = PrismaClient;

const UPLOADS_DIR = path.resolve(
  process.env.LOCAL_STORAGE_DIR ?? path.join(__dirname, "..", "..", "..", "uploads"),
);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
]);
const ELEVATED_DOWNLOAD_ROLES: readonly Role[] = ["ADMINISTRADOR", "BACKOFFICE"];

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function removeFileAfterFailure(filePath: string, originalError: unknown): Promise<never> {
  try {
    await fs.unlink(filePath);
  } catch (cleanupError: unknown) {
    if (!isMissingFileError(cleanupError)) {
      throw new AggregateError(
        [originalError, cleanupError],
        "Falha na operação e na remoção do arquivo temporário",
      );
    }
  }
  throw originalError;
}

function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 50);
  const hash = crypto.randomBytes(4).toString("hex");
  return `${Date.now()}_${hash}_${safeBase}${ext}`;
}

function assertCanViewTicket(ticket: TicketContext, viewer: Viewer): void {
  if (!canViewTicket(viewer, ticket.ownerId)) {
    throw new ApiError("not-found", "Chamado não encontrado");
  }
}

export async function listAnexosByTicketId(
  prisma: Ctx,
  chamadoId: string,
  page: number,
  size: number,
  viewer: Viewer,
) {
  const ticket = await prisma.chamado.findFirst({
    where: { id: chamadoId, deletadoEm: null },
    select: { id: true, criadoPorId: true, responsavelId: true, setorId: true },
  });
  if (!ticket) throw new ApiError("not-found", "Chamado não encontrado");
  if (!canViewTicket(viewer, ticket.criadoPorId)) {
    throw new ApiError("not-found", "Chamado não encontrado");
  }

  let isMembroSetor = false;
  if (viewer.role === "TECNICO" && ticket.setorId) {
    const vinculo = await prisma.usuarioSetor.findFirst({
      where: { setorId: ticket.setorId, usuarioId: viewer.id },
      select: { id: true },
    });
    isMembroSetor = !!vinculo;
  }
  const canDownloadAll =
    ELEVATED_DOWNLOAD_ROLES.includes(viewer.role) ||
    ticket.criadoPorId === viewer.id ||
    ticket.responsavelId === viewer.id ||
    isMembroSetor;

  const where = { chamadoId };
  const [total, items] = await Promise.all([
    prisma.anexo.count({ where }),
    prisma.anexo.findMany({
      where,
      orderBy: { enviadoEm: "asc" },
      ...toSkipTake({ page, size }),
      select: {
        id: true,
        chamadoId: true,
        enviadoPorId: true,
        nomeArquivo: true,
        mimeType: true,
        tamanhoBytes: true,
        enviadoEm: true,
        enviadoPor: { select: { id: true, nome: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((item) => ({
      ...item,
      downloadAllowed: canDownloadAll || item.enviadoPorId === viewer.id,
    })),
  };
}

export async function createAnexo(
  prisma: Ctx,
  req: FastifyRequest,
  chamadoId: string,
  viewer: Viewer,
) {
  const ticket = await prisma.chamado.findFirst({
    where: { id: chamadoId, deletadoEm: null },
    select: {
      id: true,
      protocolo: true,
      criadoPorId: true,
      responsavelId: true,
      organizacaoId: true,
      status: true,
      encerradoEm: true,
      arquivadoEm: true,
    },
  });
  if (!ticket) throw new ApiError("not-found", "Chamado não encontrado");

  const ticketContext: TicketContext = {
    ownerId: ticket.criadoPorId,
    status: ticket.status,
    closedAt: ticket.encerradoEm,
    archivedAt: ticket.arquivadoEm,
  };
  assertCanViewTicket(ticketContext, viewer);
  if (!canInteractWithTicket(ticketContext, viewer)) {
    throw new ApiError("conflict", "Chamado não aceita novos anexos");
  }

  const data = await req.file();
  if (!data) throw new ApiError("bad-request", "Nenhum arquivo enviado");
  if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
    throw new ApiError("unsupported-media-type", "Tipo de arquivo não permitido");
  }

  const buffer = await data.toBuffer();
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new ApiError("payload-too-large", "Arquivo excede o limite de 10 MB");
  }

  const uniqueFilename = generateUniqueFilename(data.filename);
  const filePath = path.join(UPLOADS_DIR, uniqueFilename);
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  try {
    await fs.writeFile(filePath, buffer);
  } catch (error: unknown) {
    await removeFileAfterFailure(filePath, error);
  }

  const anexo = await prisma.anexo.create({
    data: {
      chamadoId,
      enviadoPorId: viewer.id,
      nomeArquivo: data.filename,
      mimeType: data.mimetype,
      tamanhoBytes: buffer.byteLength,
      caminhoArquivo: uniqueFilename,
    },
    select: {
      id: true,
      chamadoId: true,
      nomeArquivo: true,
      mimeType: true,
      tamanhoBytes: true,
      enviadoEm: true,
      enviadoPor: { select: { id: true, nome: true } },
    },
  }).catch((error: unknown) => removeFileAfterFailure(filePath, error));

  const alvos = new Set<string>();
  if (ticket.criadoPorId !== viewer.id) alvos.add(ticket.criadoPorId);
  if (ticket.responsavelId && ticket.responsavelId !== viewer.id) alvos.add(ticket.responsavelId);

  if (alvos.size > 0) {
    notifyMany(prisma, Array.from(alvos), {
      titulo: "Novo anexo no chamado",
      mensagem: `Um novo arquivo (${anexo.nomeArquivo}) foi adicionado ao chamado ${ticket.protocolo ?? ticket.id}.`,
      tipo: "ANEXO_NOVO",
      canal: "IN_APP",
      chamadoId: ticket.id,
      anexoId: anexo.id,
      organizacaoId: ticket.organizacaoId ?? null,
    }).catch(() => {});
  }

  return anexo;
}

async function findAnexo(
  prisma: Ctx,
  anexoId: string,
) {
  const anexo = await prisma.anexo.findUnique({
    where: { id: anexoId },
    select: {
      id: true,
      chamadoId: true,
      caminhoArquivo: true,
      nomeArquivo: true,
      mimeType: true,
      tamanhoBytes: true,
      enviadoEm: true,
      enviadoPorId: true,
      enviadoPor: { select: { id: true, nome: true } },
      chamado: {
        select: {
          criadoPorId: true,
          responsavelId: true,
          setorId: true,
        },
      },
    },
  });
  if (!anexo) throw new ApiError("not-found", "Anexo não encontrado");

  return anexo;
}

async function canDownloadAnexo(
  prisma: Ctx,
  anexo: Awaited<ReturnType<typeof findAnexo>>,
  userId: string,
  userRole: Role,
): Promise<boolean> {
  if (ELEVATED_DOWNLOAD_ROLES.includes(userRole)) return true;
  if (
    anexo.chamado.criadoPorId === userId ||
    anexo.chamado.responsavelId === userId ||
    anexo.enviadoPorId === userId
  ) {
    return true;
  }
  if (!anexo.chamado.setorId) return false;

  const vinculo = await prisma.usuarioSetor.findFirst({
    where: { setorId: anexo.chamado.setorId, usuarioId: userId },
    select: { id: true },
  });
  return !!vinculo;
}

export async function getAnexoMetadata(
  prisma: Ctx,
  anexoId: string,
  userId: string,
  userRole: Role,
) {
  const anexo = await findAnexo(prisma, anexoId);
  const canView = userRole !== "USUARIO" || anexo.chamado.criadoPorId === userId;
  if (!canView) throw new ApiError("not-found", "Anexo não encontrado");
  const downloadAllowed = await canDownloadAnexo(prisma, anexo, userId, userRole);
  return {
    id: anexo.id,
    chamadoId: anexo.chamadoId,
    nomeArquivo: anexo.nomeArquivo,
    mimeType: anexo.mimeType,
    tamanhoBytes: anexo.tamanhoBytes,
    enviadoEm: anexo.enviadoEm,
    enviadoPor: anexo.enviadoPor,
    downloadAllowed,
  };
}

export async function getAnexoForDownload(
  prisma: Ctx,
  anexoId: string,
  userId: string,
  userRole: Role,
) {
  const anexo = await findAnexo(prisma, anexoId);
  if (!(await canDownloadAnexo(prisma, anexo, userId, userRole))) {
    throw new ApiError("forbidden", "Acesso negado a este anexo");
  }
  const filePath = path.resolve(UPLOADS_DIR, anexo.caminhoArquivo);
  const relativePath = path.relative(UPLOADS_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ApiError("not-found", "Arquivo não encontrado");
  }

  try {
    await fs.access(filePath);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new ApiError("not-found", "Arquivo físico não encontrado no servidor");
    }
    throw error;
  }

  return { filePath, fileName: anexo.nomeArquivo, mimeType: anexo.mimeType };
}
