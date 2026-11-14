/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- IPs internos e http:// são o objeto do teste: a busca precisa recusá-los (SSRF). */
import { describe, expect, it, vi } from "vitest";
import { avaliarXpath, desembrulharVisualizador, extrairUrlPdf, parecePdf } from "../../../src/core/mapa-salas/extrair-pdf";
import { buscar, ipNaoPublico, validarFormatoUrl } from "../../../src/core/mapa-salas/busca-segura";

/**
 * Página no formato da Fatec Cotia: um PDF qualquer num link antes e o mapa
 * dentro de um iframe do visualizador do Google Docs.
 */
const PAGINA = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><script async src="x.js"></script></head>
<body><header><a href="https://exemplo.gov.br/selo.pdf" target="_blank">Selo</a></header>
<div id="embed-content"><h1>Mapa de Salas</h1>
<iframe class="embed-pdf-viewer" src="https://docs.google.com/viewer?url=https%3A%2F%2Fexemplo.blob.core.windows.net%2Fsites%2F115%2F2026%2F07%2F2026-07-30-Mapas-de-Salas.pdf&#038;embedded=true" height="600"></iframe>
<p>Atualizado em <span class="data">30/07/2026</span></p>
<a class="baixar" href="/arquivos/mapa.pdf">Baixar</a></div></body></html>`;

const MAPA = "https://exemplo.blob.core.windows.net/sites/115/2026/07/2026-07-30-Mapas-de-Salas.pdf";

describe("XPath em páginas HTML", () => {
  it("acha o iframe do mapa como no navegador (sem namespace, maiúsculas, caminho do DevTools)", () => {
    expect(avaliarXpath(PAGINA, "//iframe[contains(@class,'embed-pdf-viewer')]/@src")[0]).toContain("docs.google.com/viewer");
    expect(avaliarXpath(PAGINA, "//IFRAME/@src")).toHaveLength(1);
    expect(avaliarXpath(PAGINA, '//*[@id="embed-content"]/iframe/@src')).toHaveLength(1);
  });

  it("decodifica entidades HTML no atributo (&#038; vira &)", () => {
    expect(avaliarXpath(PAGINA, "//iframe/@src")[0]).toContain("&embedded=true");
  });

  it("aceita elemento (usa href/src), texto e string()", () => {
    expect(avaliarXpath(PAGINA, "//a[@class='baixar']")).toEqual(["/arquivos/mapa.pdf"]);
    expect(avaliarXpath(PAGINA, "//span[@class='data']/text()")).toEqual(["30/07/2026"]);
    expect(avaliarXpath(PAGINA, "string(//a[@class='baixar']/@href)")).toEqual(["/arquivos/mapa.pdf"]);
  });

  it("XPath inválido vira erro 400; sem resultado, lista vazia", () => {
    expect(() => avaliarXpath(PAGINA, "//iframe[")).toThrow(/XPath inválido/);
    expect(avaliarXpath(PAGINA, "//video/@src")).toEqual([]);
  });

  it("um XPath genérico pegaria o PDF errado (o selo): por isso ele é configurável", () => {
    expect(avaliarXpath(PAGINA, "//a[contains(@href,'.pdf')]/@href")[0]).toContain("selo.pdf");
  });
});

describe("Endereço do PDF", () => {
  it("desembrulha o visualizador do Google Docs e o pdf.js; o resto passa direto", () => {
    expect(desembrulharVisualizador(`https://docs.google.com/viewer?url=${encodeURIComponent(MAPA)}&embedded=true`)).toBe(MAPA);
    expect(desembrulharVisualizador(`https://drive.google.com/viewerng/viewer?url=${encodeURIComponent(MAPA)}`)).toBe(MAPA);
    expect(desembrulharVisualizador("https://site.br/pdfjs/web/viewer.html?file=/docs/mapa.pdf")).toBe("https://site.br/docs/mapa.pdf");
    expect(desembrulharVisualizador(MAPA)).toBe(MAPA);
  });

  it("extrai o PDF da página e resolve endereço relativo", () => {
    expect(extrairUrlPdf(PAGINA, "//iframe[contains(@class,'embed-pdf-viewer')]/@src", "https://fatec.sp.gov.br/mapa-de-salas/")).toBe(MAPA);
    expect(extrairUrlPdf(PAGINA, "//a[@class='baixar']/@href", "https://fatec.sp.gov.br/mapa-de-salas/")).toBe("https://fatec.sp.gov.br/arquivos/mapa.pdf");
    expect(() => extrairUrlPdf(PAGINA, "//video/@src", "https://fatec.sp.gov.br/")).toThrow(/não encontrou nada/);
  });

  it("reconhece PDF pela assinatura, não pela extensão", () => {
    expect(parecePdf(Buffer.from("%PDF-1.4\n..."))).toBe(true);
    expect(parecePdf(Buffer.from("<html>"))).toBe(false);
  });
});

/** O motivo do erro (o que a tela mostra) fica no `detail` do ApiError. */
function detalhe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { detail?: string }).detail ?? "";
  }
  return "";
}

describe("Busca segura (SSRF)", () => {
  it("classifica endereços internos", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(ipNaoPublico(ip), ip).toBe(true);
    }
    for (const ip of ["20.60.1.1", "8.8.8.8", "2606:4700::1111"]) expect(ipNaoPublico(ip), ip).toBe(false);
  });

  it("aceita só https, sem usuário/senha e na porta padrão", () => {
    expect(detalhe(() => validarFormatoUrl("http://fatec.sp.gov.br"))).toMatch(/https/);
    expect(detalhe(() => validarFormatoUrl("https://user:senha@fatec.sp.gov.br"))).toMatch(/usuário ou senha/);
    expect(detalhe(() => validarFormatoUrl("https://fatec.sp.gov.br:8443/"))).toMatch(/porta/);
    expect(detalhe(() => validarFormatoUrl("isso não é url"))).toMatch(/Não é um endereço/);
    expect(validarFormatoUrl("https://fatec.sp.gov.br/mapa").hostname).toBe("fatec.sp.gov.br");
  });

  const publico = async () => [{ address: "20.60.1.1", family: 4 }];
  const resposta = (corpo: string | Buffer, init: ResponseInit = {}) => new Response(corpo, init);

  it("recusa host que resolve para rede interna (antes de conectar)", async () => {
    const fetch = vi.fn();
    await expect(buscar("https://interno.exemplo/", { maxBytes: 1000 }, { fetch, lookup: async () => [{ address: "10.0.0.5", family: 4 }] })).rejects.toThrow(/Endereço não permitido/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("confere cada redirecionamento: recusa redirect para os metadados da nuvem", async () => {
    const fetch = vi.fn().mockResolvedValue(resposta("", { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }));
    await expect(buscar("https://site.exemplo/", { maxBytes: 1000 }, { fetch, lookup: publico })).rejects.toMatchObject({ detail: expect.stringMatching(/169\.254\.169\.254 aponta para uma rede interna/) });
  });

  it("segue redirecionamento válido e limita a quantidade", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(resposta("", { status: 301, headers: { location: "/novo" } }))
      .mockResolvedValueOnce(resposta("ok", { headers: { "content-type": "text/html" } }));
    const r = await buscar("https://site.exemplo/velho", { maxBytes: 1000 }, { fetch, lookup: publico });
    expect(r.urlFinal).toBe("https://site.exemplo/novo");
    expect(r.corpo.toString()).toBe("ok");

    const loop = vi.fn().mockImplementation(async () => resposta("", { status: 302, headers: { location: "/de-novo" } }));
    await expect(buscar("https://site.exemplo/", { maxBytes: 1000, maxRedirecionamentos: 2 }, { fetch: loop, lookup: publico })).rejects.toThrow(/Redirecionamentos demais/);
  });

  it("corta arquivo maior que o limite e trata erro HTTP", async () => {
    const grande = vi.fn().mockResolvedValue(resposta(Buffer.alloc(2048)));
    await expect(buscar("https://site.exemplo/a.pdf", { maxBytes: 1024 }, { fetch: grande, lookup: publico })).rejects.toThrow(/grande demais/);
    const erro = vi.fn().mockResolvedValue(resposta("x", { status: 404 }));
    await expect(buscar("https://site.exemplo/a.pdf", { maxBytes: 1024 }, { fetch: erro, lookup: publico })).rejects.toMatchObject({ detail: expect.stringMatching(/HTTP 404/) });
  });
});