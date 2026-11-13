import type { TicketTestContext, TicketTestSession } from "../_helpers/tickets";

/** Dados reais que a infraestrutura compartilhada deve preparar para CADA teste. */
export type TicketFixtures = {
  ctx: TicketTestContext;
  aluno: TicketTestSession;
  outroAluno: TicketTestSession;
  funcionario: TicketTestSession & { userId: string };
  backoffice: TicketTestSession;
  admin: TicketTestSession;
  setorId: string;
  /** Ajusta somente a pré-condição de tempo no MySQL descartável. */
  setEncerradoEm(ticketId: string, date: Date): Promise<void>;
};

/** Limpa os dados e cria usuários, vínculos e sessões reais, sem mocks. */
export type PrepareTicketFixtures = () => Promise<TicketFixtures>;

/** Faz uma chamada HTTP e deixa o teste verificar status, headers e corpo. */
export function ticketRequest(
  ctx: TicketTestContext,
  session: TicketTestSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(new URL(path, ctx.baseUrl), { ...init, headers });
}

export type TicketResource = {
  id: string;
  status: string;
  setorId: string | null;
  protocolo: string;
  arquivadoEm: string | null;
  _links: Record<string, unknown>;
};
