// src/core/auth/senha-alterada.service.ts
import { getMailDriver } from "../../config/mail";
import { escapeHtml } from "../../utils/escape-html";

export type MotivoSenhaAlterada = "troca" | "reset";

export interface DadosAvisoSenhaAlterada {
  nome?: string | null;
  emailPessoal?: string | null;
  emailEducacional?: string | null;
  motivo: MotivoSenhaAlterada;
  ip?: string;
  userAgent?: string;
  quando?: Date;
}

const MOTIVO_TEXTO: Record<MotivoSenhaAlterada, string> = {
  troca: "uma troca de senha feita dentro da sua conta",
  reset: "uma redefinição de senha feita por um link enviado ao seu e-mail",
};

/** O user-agent vem do cliente: limita o tamanho antes de ir para o e-mail. */
const USER_AGENT_MAX = 120;

const formatoData = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Sao_Paulo",
});

export interface AvisoSenhaAlterada {
  to: string;
  subject: string;
  html: string;
}

/**
 * Monta o aviso (sem enviar). Devolve `null` se o usuário não tem e-mail algum.
 * Nunca inclui senha, token ou link com token. Todo texto de origem não
 * confiável (nome, ip, user-agent) é escapado.
 */
export function montarAvisoSenhaAlterada(dados: DadosAvisoSenhaAlterada): AvisoSenhaAlterada | null {
  const to = dados.emailPessoal || dados.emailEducacional;
  if (!to) return null;

  const quando = formatoData.format(dados.quando ?? new Date());
  const detalhes: string[] = [`<li>Quando: ${escapeHtml(quando)} (horário de Brasília)</li>`];
  if (dados.ip) detalhes.push(`<li>Endereço de rede (IP): ${escapeHtml(dados.ip)}</li>`);
  if (dados.userAgent) {
    detalhes.push(`<li>Dispositivo/navegador: ${escapeHtml(dados.userAgent.slice(0, USER_AGENT_MAX))}</li>`);
  }

  const base = process.env.APP_WEB_URL?.replace(/\/+$/, "");
  const linkRedefinir = base
    ? `<p><a href="${escapeHtml(`${base}/esqueci-senha`)}">Redefinir minha senha agora</a></p>`
    : "";

  return {
    to,
    subject: "Sua senha foi alterada — Workflow Fatec",
    html: `
      <p>Olá ${escapeHtml(dados.nome ?? "")},</p>
      <p>A senha da sua conta foi alterada por meio de ${MOTIVO_TEXTO[dados.motivo]}.</p>
      <ul>${detalhes.join("")}</ul>
      <p>Por segurança, os acessos que estavam abertos foram encerrados.</p>
      <p><strong>Se foi você, não precisa fazer nada.</strong></p>
      <p><strong>Se NÃO foi você</strong>, redefina sua senha imediatamente e avise o suporte da sua unidade.</p>
      ${linkRedefinir}
    `,
  };
}

/** Envia o aviso. Sem e-mail cadastrado, não faz nada. Falha de envio propaga (quem chama decide). */
export async function enviarAvisoSenhaAlterada(dados: DadosAvisoSenhaAlterada): Promise<void> {
  const aviso = montarAvisoSenhaAlterada(dados);
  if (!aviso) return;
  await getMailDriver().send(aviso);
}
