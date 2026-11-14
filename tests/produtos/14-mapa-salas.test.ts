/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- IPs internos e http:// são o objeto do teste: a busca precisa recusá-los (SSRF). */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

vi.mock("../../src/lib/prisma");
vi.mock("../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));
// DNS simulado: os sites "públicos" do teste resolvem para um IP público. Função comum,
// não vi.fn: o resetMocks() (vi.resetAllMocks) apagaria a implementação.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === "interno.exemplo" ? [{ address: "10.0.0.8", family: 4 }] : [{ address: "20.60.1.1", family: 4 }],
}));

import { buildApp } from "../../src/app";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import { makeAdminToken, makeUserToken, bearerAuth } from "../helpers/auth";
import { resetMocks } from "../helpers/reset";
import { pastaMapas } from "../../src/core/mapa-salas/mapa-salas.service";

let app: FastifyInstance;
let aluno: Record<string, string>;
let admin: Record<string, string>;
let secretaria: Record<string, string>;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const SHA = createHash("sha256").update(PDF).digest("hex");
const PAGINA_URL = "https://fatec.exemplo/mapa-de-salas/";
const PDF_URL = "https://arquivos.exemplo/2026-07-30-Mapas-de-Salas.pdf";
const PAGINA = `<html><body><a href="https://arquivos.exemplo/selo.pdf">selo</a>
<iframe class="embed-pdf-viewer" src="https://docs.google.com/viewer?url=${encodeURIComponent(PDF_URL)}&#038;embedded=true"></iframe></body></html>`;
const XPATH = "//iframe[contains(@class,'embed-pdf-viewer')]/@src";

function versao(extra: Record<string, unknown> = {}) {
  return {
    id: "v1",
    origem: "MANUAL",
    nomeArquivo: "mapa.pdf",
    tamanhoBytes: PDF.byteLength,
    checksumSha256: SHA,
    urlOrigem: null,
    publicadoEm: new Date("2026-08-01T10:00:00Z"),
    publicadoPor: { id: "admin-id-001", nome: "Admin" },
    ...extra,
  };
}

/** Corpo multipart/form-data com um arquivo no campo "file". */
function multipart(nome: string, conteudo: Buffer, tipo = "application/pdf") {
  const boundary = "----teste-mapa-salas";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${nome}"\r\nContent-Type: ${tipo}\r\n\r\n`),
    conteudo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** fetch simulado: a página e o PDF do mapa. */
function siteSimulado(pdf: Buffer = PDF) {
  return vi.fn(async (url: string) => {
    if (url === PAGINA_URL) return new Response(PAGINA, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url === PDF_URL) return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    return new Response("não encontrado", { status: 404 });
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  aluno = bearerAuth(makeUserToken());
  admin = bearerAuth(makeAdminToken());
  secretaria = bearerAuth(makeUserToken({ sub: "sec-1", role: "BACKOFFICE" }));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

beforeEach(() => {
  resetMocks();
  vi.unstubAllGlobals();
});

describe("/room-maps — Mapa de salas (beta)", () => {
  it("GET /api oferece o link room-maps", async () => {
    const res = await app.inject({ method: "GET", url: "/api", headers: aluno });
    expect(res.json()._links["room-maps"]).toEqual({ href: "/room-maps/current", method: "GET" });
  });

  it("sem mapa publicado: atual null e sem link de arquivo; o admin vê os links de gestão", async () => {
    prismaMock.mapaSalaVersao.findFirst.mockResolvedValue(null);
    const doAluno = (await app.inject({ method: "GET", url: "/room-maps/current", headers: aluno })).json();
    expect(doAluno.atual).toBeNull();
    expect(doAluno._links.file).toBeUndefined();
    expect(doAluno._links.source).toBeUndefined();

    const doAdmin = (await app.inject({ method: "GET", url: "/room-maps/current", headers: admin })).json();
    expect(doAdmin._links.source.href).toBe("/room-maps/source");
    expect(doAdmin._links.upload.method).toBe("POST");
    expect(doAdmin._links.versions).toBeDefined();
  });

  it("o aluno baixa o PDF atual; o arquivo sai inline e como application/pdf", async () => {
    fs.mkdirSync(pastaMapas(), { recursive: true });
    fs.writeFileSync(path.join(pastaMapas(), `${SHA}.pdf`), PDF);
    prismaMock.mapaSalaVersao.findFirst.mockResolvedValue({ id: "v1", nomeArquivo: "Mapa de Salas 2026.pdf", caminhoArquivo: `${SHA}.pdf` });

    const res = await app.inject({ method: "GET", url: "/room-maps/current/file", headers: aluno });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^inline; filename="Mapa de Salas 2026.pdf"/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const baixar = await app.inject({ method: "GET", url: "/room-maps/current/file?download=1", headers: aluno });
    expect(baixar.headers["content-disposition"]).toMatch(/^attachment/);
  });

  it("o caminho gravado no banco não escapa da pasta dos mapas", async () => {
    prismaMock.mapaSalaVersao.findFirst.mockResolvedValue({ id: "v1", nomeArquivo: "x.pdf", caminhoArquivo: "../../../etc/passwd" });
    const res = await app.inject({ method: "GET", url: "/room-maps/current/file", headers: aluno });
    expect(res.statusCode).toBe(404);
  });

  it("404 quando ainda não há mapa", async () => {
    prismaMock.mapaSalaVersao.findFirst.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/room-maps/current/file", headers: aluno });
    expect(res.statusCode).toBe(404);
  });

  describe("envio manual", () => {
    it("o admin envia um PDF: vira a versão atual (201)", async () => {
      prismaMock.mapaSalaVersao.findFirst.mockResolvedValue(null);
      prismaMock.mapaSalaVersao.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v2", ...data, publicadoEm: new Date(), publicadoPor: null }));
      const { payload, headers } = multipart("Mapa Novo.pdf", PDF);

      const res = await app.inject({ method: "POST", url: "/room-maps/versions", headers: { ...admin, ...headers }, payload });

      expect(res.statusCode).toBe(201);
      const data = prismaMock.mapaSalaVersao.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ origem: "MANUAL", nomeArquivo: "Mapa Novo.pdf", checksumSha256: SHA, caminhoArquivo: `${SHA}.pdf`, publicadoPorId: "admin-id-001" });
      expect(fs.existsSync(path.join(pastaMapas(), `${SHA}.pdf`))).toBe(true);
    });

    it("mesmo PDF do atual: 200 e nenhuma versão nova", async () => {
      prismaMock.mapaSalaVersao.findFirst.mockResolvedValue(versao());
      const { payload, headers } = multipart("de-novo.pdf", PDF);
      const res = await app.inject({ method: "POST", url: "/room-maps/versions", headers: { ...admin, ...headers }, payload });
      expect(res.statusCode).toBe(200);
      expect(res.json().nova).toBe(false);
      expect(prismaMock.mapaSalaVersao.create).not.toHaveBeenCalled();
    });

    it("415 para arquivo que não é PDF (mesmo com extensão .pdf); 403 para aluno e secretaria", async () => {
      const falso = multipart("mapa.pdf", Buffer.from("<html>não sou pdf</html>"));
      expect((await app.inject({ method: "POST", url: "/room-maps/versions", headers: { ...admin, ...falso.headers }, payload: falso.payload })).statusCode).toBe(415);

      for (const quem of [aluno, secretaria]) {
        const { payload, headers } = multipart("mapa.pdf", PDF);
        expect((await app.inject({ method: "POST", url: "/room-maps/versions", headers: { ...quem, ...headers }, payload })).statusCode).toBe(403);
      }
    });
  });

  describe("fonte automática", () => {
    it("salva URL e XPath; recusa http e endereço com senha", async () => {
      prismaMock.mapaSalaFonte.upsert.mockResolvedValue({});
      prismaMock.mapaSalaFonte.findUnique.mockResolvedValue({ id: "padrao", url: PAGINA_URL, xpath: XPATH, atualizacaoAutomatica: true, atualizadoPor: null });

      const ok = await app.inject({ method: "PUT", url: "/room-maps/source", headers: admin, payload: { url: PAGINA_URL, xpath: XPATH, atualizacaoAutomatica: true } });
      expect(ok.statusCode).toBe(200);
      expect(prismaMock.mapaSalaFonte.upsert.mock.calls[0][0].update).toMatchObject({ url: PAGINA_URL, xpath: XPATH, atualizacaoAutomatica: true, atualizadoPorId: "admin-id-001" });
      expect(ok.json()._links.sync.method).toBe("POST");

      const http = await app.inject({ method: "PUT", url: "/room-maps/source", headers: admin, payload: { url: "http://fatec.exemplo/" } });
      expect(http.statusCode).toBe(400);
      expect(http.json().detail).toMatch(/https/);

      const senha = await app.inject({ method: "PUT", url: "/room-maps/source", headers: admin, payload: { url: "https://u:p@fatec.exemplo/" } });
      expect(senha.statusCode).toBe(400);
    });

    it("testar: acha o PDF pelo XPath (desembrulha o Google Docs) sem publicar nada", async () => {
      vi.stubGlobal("fetch", siteSimulado());
      prismaMock.mapaSalaVersao.findFirst.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/room-maps/source/test", headers: admin, payload: { url: PAGINA_URL, xpath: XPATH } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ urlPdf: PDF_URL, nomeArquivo: "2026-07-30-Mapas-de-Salas.pdf", tamanhoBytes: PDF.byteLength, igualAoAtual: false });
      expect(prismaMock.mapaSalaVersao.create).not.toHaveBeenCalled();
    });

    it("testar: XPath que pega o PDF errado é recusado se não for PDF; página interna é recusada", async () => {
      vi.stubGlobal("fetch", siteSimulado());
      const semNada = await app.inject({ method: "POST", url: "/room-maps/source/test", headers: admin, payload: { url: PAGINA_URL, xpath: "//video/@src" } });
      expect(semNada.statusCode).toBe(422);

      const interno = await app.inject({ method: "POST", url: "/room-maps/source/test", headers: admin, payload: { url: "https://interno.exemplo/mapa", xpath: XPATH } });
      expect(interno.statusCode).toBe(400);
      expect(interno.json().detail).toMatch(/rede interna/);
    });

    it("atualizar agora: publica versão AUTOMATICA e registra o resultado; repetir não duplica", async () => {
      vi.stubGlobal("fetch", siteSimulado());
      prismaMock.mapaSalaFonte.findUnique.mockResolvedValue({ id: "padrao", url: PAGINA_URL, xpath: XPATH });
      prismaMock.mapaSalaFonte.update.mockResolvedValue({});
      prismaMock.mapaSalaVersao.findFirst.mockResolvedValueOnce(null);
      prismaMock.mapaSalaVersao.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v3", ...data, publicadoEm: new Date(), publicadoPor: null }));

      const r1 = await app.inject({ method: "POST", url: "/room-maps/source/sync", headers: admin });
      expect(r1.statusCode).toBe(200);
      expect(r1.json()).toMatchObject({ nova: true, resultado: "Nova versão publicada" });
      expect(prismaMock.mapaSalaVersao.create.mock.calls[0][0].data).toMatchObject({ origem: "AUTOMATICA", urlOrigem: PDF_URL, nomeArquivo: "2026-07-30-Mapas-de-Salas.pdf" });
      expect(prismaMock.mapaSalaFonte.update.mock.calls[0][0].data).toMatchObject({ ultimoResultado: "Nova versão publicada", ultimoErro: null });

      prismaMock.mapaSalaVersao.findFirst.mockResolvedValueOnce(versao({ origem: "AUTOMATICA" }));
      const r2 = await app.inject({ method: "POST", url: "/room-maps/source/sync", headers: admin });
      expect(r2.json()).toMatchObject({ nova: false });
      expect(prismaMock.mapaSalaVersao.create).toHaveBeenCalledTimes(1);
    });

    it("atualizar agora: falha fica registrada na fonte; sem fonte configurada, 409", async () => {
      vi.stubGlobal("fetch", siteSimulado(Buffer.from("<html>erro do site</html>")));
      prismaMock.mapaSalaFonte.findUnique.mockResolvedValue({ id: "padrao", url: PAGINA_URL, xpath: XPATH });
      prismaMock.mapaSalaFonte.update.mockResolvedValue({});

      const falha = await app.inject({ method: "POST", url: "/room-maps/source/sync", headers: admin });
      expect(falha.statusCode).toBe(422);
      expect(prismaMock.mapaSalaFonte.update.mock.calls[0][0].data).toMatchObject({ ultimoResultado: "Falhou", ultimoErro: expect.stringMatching(/não é um PDF/) });

      prismaMock.mapaSalaFonte.findUnique.mockResolvedValue(null);
      expect((await app.inject({ method: "POST", url: "/room-maps/source/sync", headers: admin })).statusCode).toBe(409);
    });

    it("só o admin mexe na fonte; a secretaria vê o histórico", async () => {
      expect((await app.inject({ method: "GET", url: "/room-maps/source", headers: secretaria })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/room-maps/source/sync", headers: aluno })).statusCode).toBe(403);

      prismaMock.mapaSalaVersao.count.mockResolvedValue(1);
      prismaMock.mapaSalaVersao.findMany.mockResolvedValue([versao()]);
      const hist = await app.inject({ method: "GET", url: "/room-maps/versions", headers: secretaria });
      expect(hist.statusCode).toBe(200);
      expect(hist.json()._embedded["room-map-versions"][0]._links.file.href).toBe("/room-maps/versions/v1/file");
      expect((await app.inject({ method: "GET", url: "/room-maps/versions", headers: aluno })).statusCode).toBe(403);
    });
  });
});