import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "../../hateoas";

/**
 * Busca de URLs informadas por um administrador (página do mapa de salas e o PDF).
 *
 * Como o servidor vai buscar um endereço digitado na tela, é preciso evitar que ele
 * seja usado para alcançar a rede interna (SSRF): só https, nada de IP privado, de
 * loopback ou de metadados da nuvem (169.254.169.254), redirecionamentos conferidos
 * um a um, tempo e tamanho limitados.
 */

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface BuscaDeps {
  fetch?: FetchFn;
  lookup?: LookupFn;
}

export interface BuscaOpcoes {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirecionamentos?: number;
}

export interface Resposta {
  urlFinal: string;
  contentType: string;
  corpo: Buffer;
}

const USER_AGENT = "WorkflowFatec-MapaDeSalas/1.0 (+https://github.com/4dsm2026)";

const lookupPadrao: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local e metadados da nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast e reservados
  );
}

function ipv6Privado(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapeado) return ipv4Privado(mapeado[1]);
  return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
}

/** Endereço que não pode ser alcançado a partir de um URL informado na tela. */
export function ipNaoPublico(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Privado(ip);
  if (v === 6) return ipv6Privado(ip);
  return true;
}

/** Confere o formato do URL (sem rede). Lança ApiError 400 com o motivo. */
export function validarFormatoUrl(bruto: string): URL {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new ApiError("bad-request", "URL inválida", `Não é um endereço válido: ${bruto}`);
  }
  if (url.protocol !== "https:") throw new ApiError("bad-request", "URL inválida", "Use um endereço https://");
  if (url.username || url.password) throw new ApiError("bad-request", "URL inválida", "O endereço não pode conter usuário ou senha");
  if (url.port && url.port !== "443") throw new ApiError("bad-request", "URL inválida", "Use a porta padrão do https (443)");
  return url;
}

/** Resolve o nome e recusa se algum endereço for interno. */
async function exigirHostPublico(url: URL, lookup: LookupFn): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const enderecos = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host).catch(() => []);
  if (enderecos.length === 0) {
    throw new ApiError("bad-request", "Endereço não encontrado", `Não foi possível resolver ${host}`);
  }
  if (enderecos.some((e) => ipNaoPublico(e.address))) {
    throw new ApiError("bad-request", "Endereço não permitido", `${host} aponta para uma rede interna`);
  }
}

async function lerComLimite(resposta: Response, maxBytes: number): Promise<Buffer> {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > maxBytes) {
    throw new ApiError("payload-too-large", "Arquivo grande demais", `O limite é ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (!resposta.body) return Buffer.alloc(0);
  const partes: Buffer[] = [];
  let total = 0;
  const leitor = resposta.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => {});
      throw new ApiError("payload-too-large", "Arquivo grande demais", `O limite é ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes);
}

function falhaDeConexao(url: URL, e: unknown): ApiError {
  const nome = e instanceof Error ? e.name : "";
  const motivo = nome === "TimeoutError" || nome === "AbortError" ? "o site demorou demais para responder" : "não foi possível conectar";
  return new ApiError("bad-request", "Falha ao acessar o endereço", `${url.hostname}: ${motivo}`);
}

async function requisitar(url: URL, opcoes: BuscaOpcoes, fetchFn: FetchFn): Promise<Response> {
  try {
    return await fetchFn(url.toString(), {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 15_000),
    });
  } catch (e) {
    throw falhaDeConexao(url, e);
  }
}

async function lerCorpo(resposta: Response, url: URL, maxBytes: number): Promise<Buffer> {
  try {
    return await lerComLimite(resposta, maxBytes);
  } catch (e) {
    // O tempo também pode estourar no meio do download.
    throw e instanceof ApiError ? e : falhaDeConexao(url, e);
  }
}

/** GET seguro: https, host público a cada redirecionamento, tempo e tamanho limitados. */
export async function buscar(endereco: string, opcoes: BuscaOpcoes, deps: BuscaDeps = {}): Promise<Resposta> {
  const fetchFn: FetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
  const lookup = deps.lookup ?? lookupPadrao;
  const maxRedir = opcoes.maxRedirecionamentos ?? 3;
  let url = validarFormatoUrl(endereco);

  for (let salto = 0; ; salto++) {
    await exigirHostPublico(url, lookup);
    const resposta = await requisitar(url, opcoes, fetchFn);
    const destino = resposta.status >= 300 && resposta.status < 400 ? resposta.headers.get("location") : null;

    if (destino) {
      if (salto >= maxRedir) throw new ApiError("bad-request", "Redirecionamentos demais", url.toString());
      url = validarFormatoUrl(new URL(destino, url).toString());
      continue;
    }
    if (!resposta.ok) {
      throw new ApiError("bad-request", "O site respondeu com erro", `${url.toString()} → HTTP ${resposta.status}`);
    }
    const corpo = await lerCorpo(resposta, url, opcoes.maxBytes);
    return { urlFinal: url.toString(), contentType: (resposta.headers.get("content-type") ?? "").toLowerCase(), corpo };
  }
}
