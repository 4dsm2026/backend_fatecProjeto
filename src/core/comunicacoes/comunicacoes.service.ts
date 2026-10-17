import type { PrismaClient } from "@prisma/client";
import { toSkipTake } from "../../hateoas";
import type { ComunicacaoListQuery, ComunicacaoListResult, ComunicacaoTemplate } from "./comunicacoes.types";

type Ctx = PrismaClient;

/** Lista templates persistidos em uma página (o front mescla com os defaults). */
export async function listTemplates(prisma: Ctx, query: ComunicacaoListQuery): Promise<ComunicacaoListResult> {
  const { skip, take } = toSkipTake(query);
  const [items, total] = await Promise.all([
    prisma.comunicacaoTemplate.findMany({ orderBy: { chave: "asc" }, skip, take }),
    prisma.comunicacaoTemplate.count(),
  ]);
  return { items, total };
}

export async function getTemplate(prisma: Ctx, chave: string): Promise<ComunicacaoTemplate | null> {
  return prisma.comunicacaoTemplate.findUnique({ where: { chave } });
}

/** Cria ou atualiza um template pela chave. */
export async function upsertTemplate(
  prisma: Ctx,
  chave: string,
  data: {
    nome: string;
    descricao?: string | null;
    habilitado?: boolean;
    assunto: string;
    corpo: string;
    variaveis?: string[];
  },
): Promise<ComunicacaoTemplate> {
  const payload = {
    nome: data.nome,
    descricao: data.descricao ?? null,
    habilitado: data.habilitado ?? true,
    assunto: data.assunto,
    corpo: data.corpo,
    variaveis: data.variaveis ?? undefined,
  };
  return prisma.comunicacaoTemplate.upsert({
    where: { chave },
    create: { chave, ...payload },
    update: payload,
  });
}

/**
 * Substitui placeholders {{chave}} por um valor de exemplo, para o envio de
 * teste. Chaves desconhecidas viram "[exemplo]" em vez de ficarem cruas.
 */
const AMOSTRA: Record<string, string> = {
  "aluno.nome": "Maria Aluna",
  "organizacao.nome": "Fatec Cotia",
  "organizacao.sigla": "FATEC",
  "chamado.protocolo": "TCK-EXEMPLO1",
  "chamado.titulo": "Exemplo de chamado",
  "chamado.status": "EM_ATENDIMENTO",
  "chamado.nivel": "N1",
  "chamado.prioridade": "MEDIA",
  "setor.nome": "Secretaria",
  "historico.observacao": "Observação de exemplo",
  "token.expiraEm": "1 hora",
  "links.portalAluno": "https://exemplo/aluno",
  "links.portalAlunoChamado": "https://exemplo/aluno/chamados/1",
  "links.redefinirSenha": "https://exemplo/reset-senha",
  "links.resetSenha": "https://exemplo/reset-senha",
};

export function renderComAmostra(texto: string): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, chave) => AMOSTRA[chave] ?? "[exemplo]");
}
