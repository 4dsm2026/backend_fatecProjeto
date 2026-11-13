/** Contexto mínimo de que o helper precisa; a infraestrutura fornece a URL. */
export type TicketTestContext = { baseUrl: string };

/** O token deve vir de um login real feito pelo helper de autenticação. */
export type TicketTestSession = { accessToken: string };

export type TicketStatus =
  | "ABERTO"
  | "EM_ATENDIMENTO"
  | "AGUARDANDO_USUARIO"
  | "RESOLVIDO"
  | "ENCERRADO";

export type CreateTicketInput = {
  titulo?: string;
  descricao?: string;
  setorId?: string | null;
  servicoId?: string | null;
  catalogoServicoId?: string | null;
  categoriaId?: string | null;
  categoriaNome?: string | null;
  prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE";
  nivel?: "N1" | "N2" | "N3";
};

export type CreatedTicket = { id: string; [field: string]: unknown };

async function requestTicket(
  ctx: TicketTestContext,
  session: TicketTestSession,
  path: string,
  method: "POST" | "PATCH",
  body: object,
  expectedStatus: number,
): Promise<Response> {
  const response = await fetch(new URL(path, ctx.baseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status !== expectedStatus) {
    const detail = await response.text();
    throw new Error(
      `${method} ${path}: esperado ${expectedStatus}, recebido ${response.status}. ${detail}`,
    );
  }

  return response;
}

/** Cria a pré-condição por HTTP e devolve o recurso completo retornado pela API. */
export async function createTicket(
  ctx: TicketTestContext,
  session: TicketTestSession,
  overrides: CreateTicketInput = {},
): Promise<CreatedTicket> {
  const response = await requestTicket(ctx, session, "/tickets", "POST", {
    titulo: "Chamado de teste",
    descricao: "Descrição de um chamado criado durante o teste.",
    ...overrides,
  }, 201);
  const resource = (await response.json()) as CreatedTicket;
  if (typeof resource?.id !== "string" || !resource.id) {
    throw new Error("POST /tickets: a resposta não trouxe um id de chamado válido.");
  }
  return resource;
}

/** Atribui o chamado pelo mesmo PATCH usado pelos clientes da API. */
export async function assignTicket(
  ctx: TicketTestContext,
  session: TicketTestSession,
  ticketId: string,
  userId: string,
): Promise<void> {
  await requestTicket(ctx, session, `/tickets/${encodeURIComponent(ticketId)}`, "PATCH", {
    responsavelId: userId,
  }, 200);
}

/** Pede a transição de status; a API continua responsável por validar a regra. */
export async function changeStatus(
  ctx: TicketTestContext,
  session: TicketTestSession,
  ticketId: string,
  status: TicketStatus,
): Promise<void> {
  await requestTicket(ctx, session, `/tickets/${encodeURIComponent(ticketId)}`, "PATCH", {
    status,
  }, 200);
}
