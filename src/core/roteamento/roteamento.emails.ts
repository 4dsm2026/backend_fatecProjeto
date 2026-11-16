import type { PrismaClient } from "@prisma/client";
import { getMailDriver } from "../../config/mail";
import { env } from "../../env";
import { escapeHtml } from "../../utils/escape-html";
import { bestEffort } from "../../utils/best-effort";
import { getTemplate } from "../comunicacoes/comunicacoes.service";

/**
 * E-mails do roteamento. Os textos são editáveis na tela de Comunicações (mesmas
 * chaves); sem modelo salvo, valem os padrões abaixo. Modelo desabilitado = não envia.
 */

export type ChaveEmail = "TICKET_ROUTED" | "TICKET_ESCALATED";

export const MODELOS_PADRAO: Record<ChaveEmail, { assunto: string; corpo: string }> = {
  TICKET_ROUTED: {
    assunto: "Novo chamado {{chamado.protocolo}} para {{setor.nome}}",
    corpo:
      "Olá {{destinatario.nome}},<br/><br/>" +
      "Chegou um chamado para <b>{{setor.nome}}</b>{{destinatario.emCopia}}.<br/>" +
      "<b>{{chamado.protocolo}}</b> — {{chamado.titulo}}<br/>" +
      "Serviço: {{chamado.servico}} — Prioridade: {{chamado.prioridade}}<br/>" +
      "Aberto por: {{chamado.solicitante}}<br/><br/>" +
      'Abrir no sistema: <a href="{{links.chamadoAdmin}}">{{links.chamadoAdmin}}</a>',
  },
  TICKET_ESCALATED: {
    assunto: "Chamado {{chamado.protocolo}} sem atendimento há {{prazo.horas}} h úteis",
    corpo:
      "Olá {{destinatario.nome}},<br/><br/>" +
      "O chamado <b>{{chamado.protocolo}}</b> — {{chamado.titulo}} — chegou em <b>{{setor.nome}}</b> " +
      "e ninguém o assumiu dentro do prazo de {{prazo.horas}} h úteis.<br/><br/>" +
      'Abrir no sistema: <a href="{{links.chamadoAdmin}}">{{links.chamadoAdmin}}</a>',
  },
};

export type VariaveisEmail = Record<string, string>;

/**
 * Troca {{chave}} pelo valor; chave desconhecida vira vazio. No corpo (HTML) o valor é
 * escapado, porque título e nome vêm do usuário; no assunto (texto puro), não.
 */
export function renderizar(texto: string, variaveis: VariaveisEmail, html = true): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, chave: string) => {
    const valor = variaveis[chave] ?? "";
    return html ? escapeHtml(valor) : valor.replace(/[\r\n]+/g, " ");
  });
}

export function linkDoChamado(chamadoId: string): string {
  let base = env.APP_WEB_URL ?? "";
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base ? `${base}/admin/chamados/${encodeURIComponent(chamadoId)}` : "";
}

export interface Destinatario {
  email: string;
  nome: string;
  emCopia: boolean;
}

/**
 * Envia um e-mail por destinatário (cada um vê só o próprio endereço). Falha de um
 * envio não impede os outros nem derruba a abertura do chamado.
 */
export async function enviarEmails(
  prisma: PrismaClient,
  chave: ChaveEmail,
  destinatarios: readonly Destinatario[],
  variaveis: VariaveisEmail,
): Promise<number> {
  if (!destinatarios.length) return 0;
  const salvo = await getTemplate(prisma, chave).catch(() => null);
  if (salvo && !salvo.habilitado) return 0;
  const modelo = salvo ?? MODELOS_PADRAO[chave];
  const driver = getMailDriver();

  let enviados = 0;
  for (const d of destinatarios) {
    const vars = { ...variaveis, "destinatario.nome": d.nome, "destinatario.emCopia": d.emCopia ? " (você está em cópia)" : "" };
    const assunto = renderizar(modelo.assunto, vars, false);
    await bestEffort(
      `email-${chave}`,
      driver.send({ to: d.email, subject: assunto, html: renderizar(modelo.corpo, vars) }).then(() => {
        enviados++;
      }),
    );
  }
  return enviados;
}
