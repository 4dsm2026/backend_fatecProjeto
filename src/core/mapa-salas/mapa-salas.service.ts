import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { ApiError, isAdmin, toSkipTake } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { env } from "../../env";
import { registrarAuditoria } from "../../lib/auditoria";
import { bestEffort } from "../../utils/best-effort";
import { buscar, validarFormatoUrl, type BuscaDeps } from "./busca-segura";
import { extrairUrlPdf, parecePdf } from "./extrair-pdf";

type Ctx = PrismaClient;

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // mesmo limite do upload multipart
const MAX_HTML_BYTES = 3 * 1024 * 1024;
/**
 * Tempo por requisição. Sites institucionais oscilam muito (a página da Fatec Cotia
 * levou de 2 a 40 s em 14/11/2026). Página + PDF precisam caber nos 60 s do nginx.
 */
const TIMEOUT_MS = 25_000;
const FONTE_ID = "padrao";

/** Onde os PDFs ficam: a mesma área dos anexos (volume com backup na produção). */
export function pastaMapas(): string {
  return path.resolve(process.env.LOCAL_STORAGE_DIR ?? env.LOCAL_STORAGE_DIR, "mapas-de-sala");
}

const SELECT_VERSAO = {
  id: true,
  origem: true,
  nomeArquivo: true,
  tamanhoBytes: true,
  checksumSha256: true,
  urlOrigem: true,
  publicadoEm: true,
  publicadoPor: { select: { id: true, nome: true } },
} as const;

function exigirAdmin(viewer: Viewer) {
  if (!isAdmin(viewer)) throw new ApiError("forbidden", "Somente administradores gerenciam o mapa de salas");
}

/* ===================== Consulta ===================== */

export async function versaoAtual(prisma: Ctx) {
  return prisma.mapaSalaVersao.findFirst({ orderBy: { publicadoEm: "desc" }, select: SELECT_VERSAO });
}

export async function listarVersoes(prisma: Ctx, query: { page: number; size: number }) {
  const { skip, take } = toSkipTake(query);
  const [total, items] = await Promise.all([
    prisma.mapaSalaVersao.count(),
    prisma.mapaSalaVersao.findMany({ orderBy: { publicadoEm: "desc" }, skip, take, select: SELECT_VERSAO }),
  ]);
  return { total, page: query.page, size: query.size, items };
}

/** Caminho do PDF no disco, para enviar ao navegador. */
export async function arquivoDaVersao(prisma: Ctx, id?: string) {
  const versao = id
    ? await prisma.mapaSalaVersao.findUnique({ where: { id }, select: { id: true, nomeArquivo: true, caminhoArquivo: true } })
    : await prisma.mapaSalaVersao.findFirst({ orderBy: { publicadoEm: "desc" }, select: { id: true, nomeArquivo: true, caminhoArquivo: true } });
  if (!versao) throw new ApiError("not-found", id ? "Versão não encontrada" : "Ainda não há mapa de salas publicado");

  const caminho = path.join(pastaMapas(), path.basename(versao.caminhoArquivo));
  try {
    await fs.access(caminho);
  } catch {
    throw new ApiError("not-found", "Arquivo do mapa não encontrado no servidor");
  }
  return { caminho, nomeArquivo: versao.nomeArquivo };
}

/* ===================== Publicação ===================== */

function nomeSeguro(nome: string): string {
  const base = path.basename(nome).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base || "mapa-de-salas"}.pdf`;
}

/**
 * Guarda o PDF como nova versão, se for diferente do atual (compara o SHA-256).
 * O arquivo é gravado com o hash no nome: o mesmo PDF nunca ocupa espaço duas vezes.
 */
export async function publicarPdf(
  prisma: Ctx,
  dados: { corpo: Buffer; nomeArquivo: string; origem: "AUTOMATICA" | "MANUAL"; urlOrigem?: string | null; publicadoPorId?: string | null },
) {
  if (!parecePdf(dados.corpo)) {
    throw new ApiError("unsupported-media-type", "O arquivo não é um PDF");
  }
  if (dados.corpo.byteLength > MAX_PDF_BYTES) {
    throw new ApiError("payload-too-large", "PDF grande demais", "O limite é 10 MB");
  }
  const checksum = createHash("sha256").update(dados.corpo).digest("hex");
  const atual = await versaoAtual(prisma);
  if (atual?.checksumSha256 === checksum) return { nova: false, versao: atual };

  const arquivo = `${checksum}.pdf`;
  await fs.mkdir(pastaMapas(), { recursive: true });
  const destino = path.join(pastaMapas(), arquivo);
  await fs.writeFile(destino, dados.corpo, { flag: "w" });

  const versao = await prisma.mapaSalaVersao.create({
    data: {
      origem: dados.origem,
      nomeArquivo: nomeSeguro(dados.nomeArquivo),
      caminhoArquivo: arquivo,
      tamanhoBytes: dados.corpo.byteLength,
      checksumSha256: checksum,
      urlOrigem: dados.urlOrigem ?? null,
      publicadoPorId: dados.publicadoPorId ?? null,
    },
    select: SELECT_VERSAO,
  });
  return { nova: true, versao };
}

export async function enviarManual(prisma: Ctx, corpo: Buffer, nomeArquivo: string, viewer: Viewer) {
  exigirAdmin(viewer);
  const r = await publicarPdf(prisma, { corpo, nomeArquivo, origem: "MANUAL", publicadoPorId: viewer.id });
  if (r.nova) {
    await bestEffort("auditoria-mapa-upload", registrarAuditoria({ feitoPorId: viewer.id, acao: "mapa-salas.enviar", alvo: r.versao.id }));
  }
  return r;
}

/* ===================== Fonte automática ===================== */

export async function lerFonte(prisma: Ctx, viewer: Viewer) {
  exigirAdmin(viewer);
  const fonte = await prisma.mapaSalaFonte.findUnique({
    where: { id: FONTE_ID },
    include: { atualizadoPor: { select: { id: true, nome: true } } },
  });
  return fonte ?? { id: FONTE_ID, url: null, xpath: null, atualizacaoAutomatica: false, ultimaVerificacaoEm: null, ultimoResultado: null, ultimoErro: null, atualizadoEm: null, atualizadoPor: null };
}

export async function salvarFonte(
  prisma: Ctx,
  dados: { url?: string | null; xpath?: string | null; atualizacaoAutomatica?: boolean },
  viewer: Viewer,
) {
  exigirAdmin(viewer);
  if (dados.url) validarFormatoUrl(dados.url);
  const campos = {
    ...(dados.url !== undefined ? { url: dados.url || null } : {}),
    ...(dados.xpath !== undefined ? { xpath: dados.xpath || null } : {}),
    ...(dados.atualizacaoAutomatica !== undefined ? { atualizacaoAutomatica: dados.atualizacaoAutomatica } : {}),
    atualizadoPorId: viewer.id,
  };
  await prisma.mapaSalaFonte.upsert({ where: { id: FONTE_ID }, create: { id: FONTE_ID, ...campos }, update: campos });
  await bestEffort("auditoria-mapa-fonte", registrarAuditoria({ feitoPorId: viewer.id, acao: "mapa-salas.fonte", meta: dados }));
  return lerFonte(prisma, viewer);
}

/** Baixa a página, acha o PDF pelo XPath e baixa o PDF. Não grava nada. */
export async function buscarPdfDaFonte(url: string, expressao: string, deps: BuscaDeps = {}) {
  const pagina = await buscar(url, { maxBytes: MAX_HTML_BYTES, timeoutMs: TIMEOUT_MS }, deps);
  if (parecePdf(pagina.corpo)) {
    // A URL já é o próprio PDF: o XPath não é necessário.
    return { urlPdf: pagina.urlFinal, corpo: pagina.corpo };
  }
  const urlPdf = extrairUrlPdf(pagina.corpo.toString("utf8"), expressao, pagina.urlFinal);
  const pdf = await buscar(urlPdf, { maxBytes: MAX_PDF_BYTES, timeoutMs: TIMEOUT_MS }, deps);
  if (!parecePdf(pdf.corpo)) {
    throw new ApiError("unprocessable", "O endereço encontrado não é um PDF", `${urlPdf} (${pdf.contentType || "tipo desconhecido"})`);
  }
  return { urlPdf: pdf.urlFinal, corpo: pdf.corpo };
}

function nomeDoPdf(urlPdf: string): string {
  try {
    return decodeURIComponent(path.basename(new URL(urlPdf).pathname)) || "mapa-de-salas.pdf";
  } catch {
    return "mapa-de-salas.pdf";
  }
}

function resumoDoErro(e: unknown): string {
  if (e instanceof ApiError) return [e.message, e.detail].filter(Boolean).join(": ");
  return e instanceof Error ? e.message : String(e);
}

/** "Testar": mostra o que seria baixado, sem publicar. */
export async function testarFonte(prisma: Ctx, dados: { url: string; xpath: string }, viewer: Viewer, deps: BuscaDeps = {}) {
  exigirAdmin(viewer);
  const { urlPdf, corpo } = await buscarPdfDaFonte(dados.url, dados.xpath, deps);
  const checksum = createHash("sha256").update(corpo).digest("hex");
  const atual = await versaoAtual(prisma);
  return { urlPdf, nomeArquivo: nomeDoPdf(urlPdf), tamanhoBytes: corpo.byteLength, igualAoAtual: atual?.checksumSha256 === checksum };
}

/**
 * Busca o mapa na fonte configurada e publica se mudou. Registra o resultado na fonte.
 * `viewer` ausente = execução automática (job diário).
 */
export async function sincronizar(prisma: Ctx, viewer: Viewer | null, deps: BuscaDeps = {}) {
  if (viewer) exigirAdmin(viewer);
  const fonte = await prisma.mapaSalaFonte.findUnique({ where: { id: FONTE_ID } });
  if (!fonte?.url || !fonte.xpath) {
    throw new ApiError("conflict", "Fonte não configurada", "Informe a URL da página e o XPath do PDF.");
  }
  const agora = new Date();
  try {
    const { urlPdf, corpo } = await buscarPdfDaFonte(fonte.url, fonte.xpath, deps);
    const r = await publicarPdf(prisma, { corpo, nomeArquivo: nomeDoPdf(urlPdf), origem: "AUTOMATICA", urlOrigem: urlPdf, publicadoPorId: viewer?.id ?? null });
    const resultado = r.nova ? "Nova versão publicada" : "Sem mudança: o PDF é o mesmo da versão atual";
    await prisma.mapaSalaFonte.update({ where: { id: FONTE_ID }, data: { ultimaVerificacaoEm: agora, ultimoResultado: resultado, ultimoErro: null } });
    if (r.nova) {
      await bestEffort(
        "auditoria-mapa-sync",
        registrarAuditoria({ feitoPorId: viewer?.id ?? null, acao: "mapa-salas.atualizar", alvo: r.versao.id, meta: { urlPdf, automatico: !viewer } }),
      );
    }
    return { ...r, resultado };
  } catch (e) {
    const detalhe = resumoDoErro(e);
    await prisma.mapaSalaFonte
      .update({ where: { id: FONTE_ID }, data: { ultimaVerificacaoEm: agora, ultimoResultado: "Falhou", ultimoErro: detalhe.slice(0, 500) } })
      .catch(() => {});
    throw e;
  }
}
