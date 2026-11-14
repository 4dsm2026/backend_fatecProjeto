import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { ApiError } from "../../hateoas";

/**
 * Acha o endereço do PDF do mapa de salas numa página HTML, com o XPath configurado.
 *
 * - O XPath roda em modo HTML: `//iframe/@src` funciona como no navegador, sem
 *   namespace, e aceita o que o DevTools gera em "Copiar XPath".
 * - O resultado pode ser um atributo (`/@href`, `/@src`), um elemento (usa href,
 *   src ou data) ou texto (`string(...)`).
 * - Visualizadores embutidos (Google Docs, pdf.js) são "desembrulhados": o PDF de
 *   verdade vai no parâmetro `url=` ou `file=`.
 */

const ATRIBUTOS_DE_ENDERECO = ["href", "src", "data"];

/** A API `parse` do pacote xpath existe em tempo de execução, mas não nos tipos da 0.0.34. */
type ContextoXpath = { node: unknown; isHtml: boolean };
type XpathCompilado = { select(ctx: ContextoXpath): unknown; evaluateString(ctx: ContextoXpath): string };
const xpathParse = (xpath as unknown as { parse(expressao: string): XpathCompilado }).parse;

const SEM_AVISOS = { warning: () => {}, error: () => {}, fatalError: () => {} };

type NoXml = {
  nodeType: number;
  nodeValue?: string | null;
  value?: string;
  textContent?: string | null;
  getAttribute?: (nome: string) => string | null;
};

function valorDoNo(no: NoXml): string {
  if (no.nodeType === 2) return no.value ?? no.nodeValue ?? ""; // atributo
  if (no.nodeType === 1 && no.getAttribute) {
    for (const a of ATRIBUTOS_DE_ENDERECO) {
      const v = no.getAttribute(a);
      if (v) return v;
    }
  }
  return no.textContent ?? no.nodeValue ?? "";
}

/** Avalia o XPath e devolve os valores encontrados (na ordem do documento). */
export function avaliarXpath(html: string, expressao: string): string[] {
  const doc = new DOMParser({ errorHandler: SEM_AVISOS }).parseFromString(html, "text/html");
  let compilado: XpathCompilado;
  try {
    compilado = xpathParse(expressao);
  } catch (e) {
    throw new ApiError("bad-request", "XPath inválido", e instanceof Error ? e.message : String(e));
  }
  const ctx: ContextoXpath = { node: doc, isHtml: true };
  try {
    const nos = compilado.select(ctx) as unknown as NoXml[];
    return nos.map(valorDoNo).map((v) => v.trim()).filter(Boolean);
  } catch {
    // Expressão que devolve texto, número ou booleano (ex.: string(//a/@href)).
    const texto = compilado.evaluateString(ctx).trim();
    return texto ? [texto] : [];
  }
}

/** Visualizadores que recebem o PDF num parâmetro da URL. */
export function desembrulharVisualizador(endereco: string): string {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return endereco;
  }
  const host = url.hostname.toLowerCase();
  const google = (host === "docs.google.com" || host === "drive.google.com") && /\/viewer(ng)?(\/|$)|\/viewerng\/viewer/.test(url.pathname);
  if (google && url.searchParams.get("url")) return url.searchParams.get("url") as string;
  if (/viewer\.html$/.test(url.pathname) && url.searchParams.get("file")) {
    return new URL(url.searchParams.get("file") as string, url).toString();
  }
  return endereco;
}

/** Endereço absoluto do PDF, a partir da página e do XPath. */
export function extrairUrlPdf(html: string, expressao: string, urlPagina: string): string {
  const valores = avaliarXpath(html, expressao);
  if (valores.length === 0) {
    throw new ApiError("unprocessable", "XPath não encontrou nada", "Nenhum elemento da página corresponde ao XPath configurado.");
  }
  const absoluto = new URL(valores[0], urlPagina).toString();
  return desembrulharVisualizador(absoluto);
}

export function parecePdf(corpo: Buffer): boolean {
  return corpo.subarray(0, 5).toString("latin1") === "%PDF-";
}
