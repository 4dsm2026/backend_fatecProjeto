import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { FastifyRequest } from 'fastify';
import { notifyMany } from '../notifications/notify';

type Ctx = PrismaClient;

const UPLOADS_DIR = path.resolve(
  process.env.LOCAL_STORAGE_DIR ?? path.join(__dirname, '..', '..', '..', 'uploads'),
);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
]);

const generateUniqueFilename = (originalName: string): string => {
  const ext = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50);
  const hash = crypto.randomBytes(4).toString('hex');
  return `${Date.now()}_${hash}_${safeBase}${ext}`;
};

export async function listAnexosByTicketId(prisma: Ctx, chamadoId: string) {
  await prisma.chamado.findUniqueOrThrow({ where: { id: chamadoId } });
  return prisma.anexo.findMany({
    where: { chamadoId },
    orderBy: { enviadoEm: 'asc' },
    select: {
      id: true,
      nomeArquivo: true,
      mimeType: true,
      tamanhoBytes: true,
      enviadoEm: true,
      enviadoPor: { select: { id: true, nome: true } },
    },
  });
}

export async function createAnexo(
  prisma: Ctx,
  req: FastifyRequest,
  chamadoId: string,
  userId: string,
) {
  const data = await req.file();
  if (!data) throw Object.assign(new Error('Nenhum arquivo enviado.'), { statusCode: 400 });

  if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
    throw Object.assign(
      new Error(`Tipo de arquivo não permitido: ${data.mimetype}`),
      { statusCode: 415 },
    );
  }

  const chamado = await prisma.chamado.findUnique({
    where: { id: chamadoId },
    select: { id: true, protocolo: true, criadoPorId: true, responsavelId: true, organizacaoId: true },
  });
  if (!chamado) {
    throw Object.assign(new Error('Chamado não encontrado'), { statusCode: 404 });
  }

  const buffer = await data.toBuffer();
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw Object.assign(
      new Error(`Arquivo excede o limite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`),
      { statusCode: 413 },
    );
  }

  const uniqueFilename = generateUniqueFilename(data.filename);
  const filePath = path.join(UPLOADS_DIR, uniqueFilename);
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(filePath, buffer);

  const anexo = await prisma.anexo.create({
    data: {
      chamadoId,
      enviadoPorId: userId,
      nomeArquivo: data.filename,
      mimeType: data.mimetype,
      tamanhoBytes: buffer.byteLength,
      caminhoArquivo: uniqueFilename,
    },
    select: {
      id: true,
      nomeArquivo: true,
      mimeType: true,
      tamanhoBytes: true,
      enviadoEm: true,
      enviadoPor: { select: { id: true, nome: true } },
    },
  });

  const alvos = new Set<string>();
  if (chamado.criadoPorId !== userId) alvos.add(chamado.criadoPorId);
  if (chamado.responsavelId && chamado.responsavelId !== userId) alvos.add(chamado.responsavelId);

  if (alvos.size > 0) {
    notifyMany(prisma, Array.from(alvos), {
      titulo: 'Novo anexo no chamado',
      mensagem: `Um novo arquivo (${anexo.nomeArquivo}) foi adicionado ao chamado ${chamado.protocolo ?? chamado.id}.`,
      tipo: 'ANEXO_NOVO',
      canal: 'IN_APP',
      chamadoId: chamado.id,
      anexoId: anexo.id,
      organizacaoId: chamado.organizacaoId ?? null,
    }).catch(() => {});
  }

  return anexo;
}

export async function getAnexoForDownload(
  prisma: Ctx,
  anexoId: string,
  userId: string,
  userRole?: string,
) {
  const anexo = await prisma.anexo.findUnique({
    where: { id: anexoId },
    select: {
      id: true,
      caminhoArquivo: true,
      nomeArquivo: true,
      mimeType: true,
      enviadoPorId: true,
      chamado: {
        select: {
          criadoPorId: true,
          responsavelId: true,
          setorId: true,
        },
      },
    },
  });

  if (!anexo) {
    throw Object.assign(new Error('Anexo não encontrado'), { statusCode: 404 });
  }

  const elevatedRoles = new Set(['ADMINISTRADOR', 'BACKOFFICE']);
  if (!userRole || !elevatedRoles.has(userRole)) {
    const isCriador = anexo.chamado.criadoPorId === userId;
    const isResponsavel = anexo.chamado.responsavelId === userId;
    const isUploader = anexo.enviadoPorId === userId;

    let isMembroSetor = false;
    if (anexo.chamado.setorId) {
      const vinculo = await prisma.usuarioSetor.findFirst({
        where: { setorId: anexo.chamado.setorId, usuarioId: userId },
        select: { id: true },
      });
      isMembroSetor = !!vinculo;
    }

    if (!isCriador && !isResponsavel && !isUploader && !isMembroSetor) {
      throw Object.assign(new Error('Acesso negado a este anexo'), { statusCode: 403 });
    }
  }

  const filePath = path.join(UPLOADS_DIR, anexo.caminhoArquivo);
  try {
    await fs.access(filePath);
  } catch {
    throw Object.assign(new Error('Arquivo físico não encontrado no servidor'), { statusCode: 404 });
  }

  return { filePath, fileName: anexo.nomeArquivo, mimeType: anexo.mimeType };
}
