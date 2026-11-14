import fs from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toCollection, toResource, viewerFrom } from "../../hateoas";
import { FonteSchema, TesteFonteSchema, VersaoIdSchema, VersoesListSchema } from "../../validators/mapa-salas";
import { ROOM_MAPS, linksDaFonte, linksDaVersao, linksDoMapa } from "./mapa-salas.links";
import {
  MAX_PDF_BYTES,
  arquivoDaVersao,
  enviarManual,
  lerFonte,
  listarVersoes,
  salvarFonte,
  sincronizar,
  testarFonte,
  versaoAtual,
} from "./mapa-salas.service";

function requireViewer(req: FastifyRequest) {
  const viewer = viewerFrom(req);
  if (!viewer) throw new ApiError("unauthorized", "Não autenticado");
  return viewer;
}

/** RFC 6266: nome em ASCII e em UTF-8, para o navegador mostrar o nome certo. */
function contentDisposition(nome: string, modo: "inline" | "attachment"): string {
  const ascii = nome.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "mapa-de-salas.pdf";
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export async function current(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const atual = await versaoAtual(req.server.prisma);
  return reply.send(toResource({ atual }, linksDoMapa(viewer, !!atual)));
}

async function enviarArquivo(req: FastifyRequest, reply: FastifyReply, id?: string) {
  const { caminho, nomeArquivo } = await arquivoDaVersao(req.server.prisma, id);
  const modo = (req.query as { download?: string } | undefined)?.download === "1" ? "attachment" : "inline";
  reply.header("Content-Type", "application/pdf");
  reply.header("Content-Disposition", contentDisposition(nomeArquivo, modo));
  // O mapa atual muda de conteúdo no mesmo endereço; uma versão específica nunca muda.
  reply.header("Cache-Control", id ? "private, max-age=86400, immutable" : "private, no-cache");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(fs.createReadStream(caminho));
}

export async function currentFile(req: FastifyRequest, reply: FastifyReply) {
  requireViewer(req);
  return enviarArquivo(req, reply);
}

export async function versionFile(req: FastifyRequest, reply: FastifyReply) {
  requireViewer(req);
  const { params } = parseOrThrow(VersaoIdSchema, { params: req.params });
  return enviarArquivo(req, reply, params.id);
}

export async function versions(req: FastifyRequest, reply: FastifyReply) {
  requireViewer(req);
  const { query } = parseOrThrow(VersoesListSchema, { query: req.query });
  const r = await listarVersoes(req.server.prisma, query);
  return reply.send(
    toCollection({
      rel: "room-map-versions",
      basePath: `${ROOM_MAPS}/versions`,
      items: r.items.map((v) => toResource(v, linksDaVersao(v.id))),
      page: r.page,
      size: r.size,
      total: r.total,
    }),
  );
}

export async function upload(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const arquivo = await req.file();
  if (!arquivo) throw new ApiError("bad-request", "Nenhum arquivo enviado");
  const corpo = await arquivo.toBuffer();
  if (arquivo.file.truncated || corpo.byteLength > MAX_PDF_BYTES) {
    throw new ApiError("payload-too-large", "PDF grande demais", "O limite é 10 MB");
  }
  const r = await enviarManual(req.server.prisma, corpo, arquivo.filename || "mapa-de-salas.pdf", viewer);
  return reply
    .code(r.nova ? 201 : 200)
    .send(toResource({ nova: r.nova, versao: r.versao }, linksDaVersao(r.versao.id)));
}

export async function getSource(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const fonte = await lerFonte(req.server.prisma, viewer);
  return reply.send(toResource(fonte, linksDaFonte(viewer, !!(fonte.url && fonte.xpath))));
}

export async function putSource(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(FonteSchema, { body: req.body });
  const fonte = await salvarFonte(req.server.prisma, body, viewer);
  return reply.send(toResource(fonte, linksDaFonte(viewer, !!(fonte.url && fonte.xpath))));
}

export async function testSource(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const { body } = parseOrThrow(TesteFonteSchema, { body: req.body });
  return reply.send(await testarFonte(req.server.prisma, body, viewer));
}

export async function syncSource(req: FastifyRequest, reply: FastifyReply) {
  const viewer = requireViewer(req);
  const r = await sincronizar(req.server.prisma, viewer);
  return reply.send(toResource({ nova: r.nova, resultado: r.resultado, versao: r.versao }, linksDaVersao(r.versao.id)));
}
