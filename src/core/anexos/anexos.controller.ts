import fs from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, toResource, viewerFrom } from "../../hateoas";
import { path } from "../../hateoas";
import { alunoSemAcessoAoChamado } from "../tickets/tickets.service";
import {
  getAnexoForDownload,
  getAnexoMetadata,
  createAnexo,
  listAnexosByTicketId,
} from "./anexos.service";
import { buildAnexoLinks } from "./anexos.hateoas";
import {
  AnexoIdParamsSchema,
  ListAnexosQuerySchema,
  TicketIdParamsSchema,
} from "./anexos.types";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

async function ensureTicketAccess(req: FastifyRequest, ticketId: string) {
  const viewer = requireViewer(req);
  const inaccessible = await alunoSemAcessoAoChamado(req.server.prisma, ticketId, {
    sub: viewer.id,
    role: viewer.role,
  });
  if (inaccessible) throw new ApiError("not-found", "Chamado não encontrado");
  return viewer;
}

function buildContentDisposition(fileName: string): string {
  const safeName = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || character === "/" || codePoint < 0x20 || codePoint === 0x7f
      ? "_"
      : character;
  }).join("").trim() || "attachment";
  const fallback = safeName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

type AttachmentResource = {
  id: string;
  chamadoId: string;
  nomeArquivo: string;
  mimeType: string;
  tamanhoBytes: number;
  enviadoEm: Date;
  enviadoPor: { id: string; nome: string };
};

function attachmentResource(anexo: AttachmentResource, downloadAllowed: boolean) {
  const { chamadoId } = anexo;
  const metadata = {
    id: anexo.id,
    nomeArquivo: anexo.nomeArquivo,
    mimeType: anexo.mimeType,
    tamanhoBytes: anexo.tamanhoBytes,
    enviadoEm: anexo.enviadoEm,
    enviadoPor: anexo.enviadoPor,
  };
  return toResource(metadata, buildAnexoLinks(anexo, chamadoId, downloadAllowed));
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { params } = parseOrThrow(TicketIdParamsSchema, { params: req.params });
  const { query } = parseOrThrow(ListAnexosQuerySchema, { query: req.query });
  const viewer = await ensureTicketAccess(req, params.id);
  const result = await listAnexosByTicketId(
    req.server.prisma,
    params.id,
    query.page,
    query.size,
    viewer,
  );

  return reply.send(
    toCollection({
      rel: "attachments",
      basePath: path`/tickets/${params.id}/attachments`,
      items: result.items.map((anexo) => {
        const { chamadoId, downloadAllowed } = anexo;
        const metadata = {
          id: anexo.id,
          nomeArquivo: anexo.nomeArquivo,
          mimeType: anexo.mimeType,
          tamanhoBytes: anexo.tamanhoBytes,
          enviadoEm: anexo.enviadoEm,
          enviadoPor: anexo.enviadoPor,
        };
        return toResource(metadata, buildAnexoLinks(anexo, chamadoId, downloadAllowed));
      }),
      page: query.page,
      size: query.size,
      total: result.total,
      links: { ticket: { href: path`/tickets/${params.id}`, method: "GET" } },
      filters: {},
    }),
  );
}

export async function upload(req: FastifyRequest, reply: FastifyReply) {
  const { params } = parseOrThrow(TicketIdParamsSchema, { params: req.params });
  const viewer = await ensureTicketAccess(req, params.id);
  const anexo = await createAnexo(req.server.prisma, req, params.id, viewer);
  const resource = attachmentResource(anexo, true);

  return reply
    .header("Location", path`/attachments/${anexo.id}`)
    .code(201)
    .send(resource);
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { params } = parseOrThrow(AnexoIdParamsSchema, { params: req.params });
  const viewer = requireViewer(req);
  const anexo = await getAnexoMetadata(
    req.server.prisma,
    params.anexoId,
    viewer.id,
    viewer.role,
  );
  return reply.send(attachmentResource(anexo, anexo.downloadAllowed));
}

export async function download(req: FastifyRequest, reply: FastifyReply) {
  const { params } = parseOrThrow(AnexoIdParamsSchema, { params: req.params });
  const viewer = requireViewer(req);
  const { filePath, fileName, mimeType } = await getAnexoForDownload(
    req.server.prisma,
    params.anexoId,
    viewer.id,
    viewer.role,
  );

  reply.header("Content-Disposition", buildContentDisposition(fileName));
  const safeMimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)
    ? mimeType
    : "application/octet-stream";
  reply.header("Content-Type", safeMimeType);
  return reply.send(fs.createReadStream(filePath));
}
