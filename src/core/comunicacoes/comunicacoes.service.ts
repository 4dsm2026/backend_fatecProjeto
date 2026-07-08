import type { PrismaClient } from "@prisma/client";

type Ctx = PrismaClient;

/** Lista todos os templates persistidos (o front mescla com os defaults). */
export async function listTemplates(prisma: Ctx) {
  return prisma.comunicacaoTemplate.findMany({ orderBy: { chave: "asc" } });
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
) {
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
