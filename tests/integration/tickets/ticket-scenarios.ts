import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignTicket, changeStatus, createTicket } from "../_helpers/tickets";
import { ticketRequest } from "./fixtures";
import type { PrepareTicketFixtures, TicketFixtures, TicketResource } from "./fixtures";

/** Chamado pelo arquivo de entrada quando o harness compartilhado estiver pronto. */
export function registerTicketScenarios(prepare: PrepareTicketFixtures): void {
  describe("Integração HTTP: chamados", () => {
    let f: TicketFixtures;
    beforeEach(async () => { f = await prepare(); });

    it("cria chamado, devolve Location e roteia para o setor informado", async () => {
      const res = await ticketRequest(f.ctx, f.aluno, "/tickets", {
        method: "POST",
        body: JSON.stringify({ titulo: "Solicitação de integração", descricao: "Preciso de atendimento.", setorId: f.setorId }),
      });
      expect(res.status).toBe(201);
      const ticket = await res.json() as TicketResource;
      expect(ticket.protocolo).toMatch(/^TCK-/);
      expect(ticket.status).toBe("ABERTO");
      expect(ticket.setorId).toBe(f.setorId);
      expect(res.headers.get("location")).toBe(`/tickets/${ticket.id}`);
      expect(ticket._links).toHaveProperty("self.href", `/tickets/${ticket.id}`);
      expect(ticket._links).toHaveProperty("reply.method", "POST");
    });

    it("roteia a solicitação Outros para o setor de triagem indicado", async () => {
      const res = await ticketRequest(f.ctx, f.aluno, "/tickets", {
        method: "POST",
        body: JSON.stringify({
          titulo: "Solicitação geral",
          descricao: "Não encontrei uma categoria específica.",
          catalogoServicoId: "outros-solicitacao-geral",
          categoriaNome: "Outros",
          setorProvavel: "Secretaria",
        }),
      });
      expect(res.status).toBe(201);
      const ticket = await res.json() as TicketResource & { catalogoServicoId: string };
      expect(ticket.catalogoServicoId).toBe("outros-solicitacao-geral");
      expect(ticket.setorId).toBe(f.setorId);
    });

    it("devolve erros de validação e autenticação no formato de problema", async () => {
      const invalid = await ticketRequest(f.ctx, f.aluno, "/tickets", {
        method: "POST", body: JSON.stringify({ titulo: "x", descricao: "x" }),
      });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get("content-type")).toContain("application/problem+json");
      const anonymous = await fetch(new URL("/tickets", f.ctx.baseUrl));
      expect(anonymous.status).toBe(401);
    });

    it("retorna 404 ao consultar ou alterar chamado inexistente", async () => {
      const get = await ticketRequest(f.ctx, f.admin, "/tickets/id-inexistente");
      const patch = await ticketRequest(f.ctx, f.admin, "/tickets/id-inexistente", {
        method: "PATCH", body: JSON.stringify({ status: "RESOLVIDO" }),
      });
      expect(get.status).toBe(404);
      expect(patch.status).toBe(404);
      expect(patch.headers.get("content-type")).toContain("application/problem+json");
    });

    it("isola chamados de outro aluno e nega arquivamento ao dono", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const other = await ticketRequest(f.ctx, f.outroAluno, `/tickets/${ticket.id}`);
      expect(other.status).toBe(404);
      const archive = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`, {
        method: "PATCH", body: JSON.stringify({ arquivado: true }),
      });
      expect(archive.status).toBe(403);
      expect(archive.headers.get("content-type")).toContain("application/problem+json");
    });

    it.each([
      { role: "aluno", edit: false, archive: false },
      { role: "funcionario", edit: true, archive: false },
      { role: "backoffice", edit: true, archive: false },
      { role: "admin", edit: true, archive: true },
    ] as const)("mostra os links de um chamado aberto para $role", async ({ role, edit, archive }) => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const response = await ticketRequest(f.ctx, f[role], `/tickets/${ticket.id}`);
      expect(response.status).toBe(200);
      const resource = await response.json() as TicketResource;
      expect(resource._links).toHaveProperty("reply.method", "POST");
      expect(Boolean(resource._links.update)).toBe(edit);
      expect(Boolean(resource._links.archive)).toBe(archive);
    });

    it("aplica a matriz de links por estado e papel durante o atendimento", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const states = ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"] as const;
      const roles = ["aluno", "funcionario", "backoffice", "admin"] as const;

      for (const [index, state] of states.entries()) {
        if (index > 0) await changeStatus(f.ctx, f.funcionario, ticket.id, state);
        for (const role of roles) {
          const response = await ticketRequest(f.ctx, f[role], `/tickets/${ticket.id}`);
          expect(response.status).toBe(200);
          const resource = await response.json() as TicketResource;
          expect(resource.status).toBe(state);
          const closed = state === "RESOLVIDO" || state === "ENCERRADO";
          expect(Boolean(resource._links.reply), `${state}/${role}: reply`).toBe(!closed);
          expect(Boolean(resource._links.upload), `${state}/${role}: upload`).toBe(!closed);
          expect(Boolean(resource._links.reopen), `${state}/${role}: reopen`).toBe(closed);
          expect(Boolean(resource._links.archive), `${state}/${role}: archive`).toBe(role === "admin");
          expect(Boolean(resource._links.update), `${state}/${role}: update`).toBe(role !== "aluno" && state !== "ENCERRADO");
        }
      }
    });

    it("inclui a conversa no detalhe e bloqueia resposta quando resolvido", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const message = await ticketRequest(f.ctx, f.funcionario, `/tickets/${ticket.id}/messages`, {
        method: "POST", body: JSON.stringify({ conteudo: "Resposta do atendimento" }),
      });
      expect(message.status).toBe(201);
      const detail = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`);
      const resource = await detail.json() as { mensagens: Array<{ conteudo: string }> };
      expect(resource.mensagens.map((item) => item.conteudo)).toContain("Resposta do atendimento");
      await changeStatus(f.ctx, f.funcionario, ticket.id, "RESOLVIDO");
      const blocked = await ticketRequest(f.ctx, f.funcionario, `/tickets/${ticket.id}/messages`, {
        method: "POST", body: JSON.stringify({ conteudo: "Nova resposta" }),
      });
      expect(blocked.status).toBe(409);
    });

    it("rejeita transição inválida e mostra ações diferentes após resolver", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const invalid = await ticketRequest(f.ctx, f.funcionario, `/tickets/${ticket.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "AGUARDANDO_USUARIO" }),
      });
      expect(invalid.status).toBe(409);
      expect(invalid.headers.get("content-type")).toContain("application/problem+json");
      await assignTicket(f.ctx, f.funcionario, ticket.id, f.funcionario.userId);
      await changeStatus(f.ctx, f.funcionario, ticket.id, "RESOLVIDO");
      const res = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`);
      expect(res.status).toBe(200);
      const resolved = await res.json() as TicketResource;
      expect(resolved._links).not.toHaveProperty("reply");
      expect(resolved._links).not.toHaveProperty("upload");
      expect(resolved._links).toHaveProperty("reopen.method", "PATCH");
    });

    it("preserva filtros nos links de paginação", async () => {
      for (let n = 0; n < 2; n++) {
        await createTicket(f.ctx, f.aluno, { titulo: `BuscaIntegracao ${n}`, setorId: f.setorId });
      }
      const res = await ticketRequest(f.ctx, f.aluno, "/tickets?search=BuscaIntegracao&page=0&size=1");
      expect(res.status).toBe(200);
      const page = await res.json() as { page: { number: number; size: number; totalElements: number }; _links: { next: { href: string } } };
      expect(page.page).toMatchObject({ number: 0, size: 1, totalElements: 2 });
      const next = new URL(page._links.next.href, f.ctx.baseUrl);
      expect(next.searchParams.get("search")).toBe("BuscaIntegracao");
      expect(next.searchParams.get("page")).toBe("1");
      expect(next.searchParams.get("size")).toBe("1");
    });

    it("esconde arquivados por padrão e permite consultá-los explicitamente", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      const archive = await ticketRequest(f.ctx, f.admin, `/tickets/${ticket.id}`, {
        method: "PATCH", body: JSON.stringify({ arquivado: true }),
      });
      expect(archive.status).toBe(200);

      const listIds = async (query: string): Promise<string[]> => {
        const response = await ticketRequest(f.ctx, f.aluno, `/tickets?${query}`);
        expect(response.status).toBe(200);
        const body = await response.json() as { _embedded: { tickets: Array<{ id: string }> } };
        return body._embedded.tickets.map((item) => item.id);
      };
      expect(await listIds("page=0&size=100")).not.toContain(ticket.id);
      expect(await listIds("page=0&size=100&arquivados=somente")).toContain(ticket.id);
      expect(await listIds("page=0&size=100&arquivados=incluir")).toContain(ticket.id);
    });

    it.each([{ days: 29, allowed: true }, { days: 31, allowed: false }])(
      "reabertura após $days dias: permitida=$allowed",
      async ({ days, allowed }) => {
        const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
        await changeStatus(f.ctx, f.funcionario, ticket.id, "RESOLVIDO");
        await f.setEncerradoEm(ticket.id, new Date(Date.now() - days * 24 * 60 * 60 * 1000));
        const view = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`);
        const resource = await view.json() as TicketResource;
        expect(Boolean(resource._links.reopen)).toBe(allowed);
        const reopen = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`, {
          method: "PATCH", body: JSON.stringify({ status: "EM_ATENDIMENTO" }),
        });
        expect(reopen.status).toBe(allowed ? 200 : 409);
      },
    );

    it("permite reabrir exatamente no limite de 30 dias", async () => {
      const ticket = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      await changeStatus(f.ctx, f.funcionario, ticket.id, "RESOLVIDO");
      const now = new Date();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      try {
        await f.setEncerradoEm(ticket.id, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        const view = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`);
        expect(view.status).toBe(200);
        const resource = await view.json() as TicketResource;
        expect(resource._links).toHaveProperty("reopen.method", "PATCH");
        const reopen = await ticketRequest(f.ctx, f.aluno, `/tickets/${ticket.id}`, {
          method: "PATCH", body: JSON.stringify({ status: "EM_ATENDIMENTO" }),
        });
        expect(reopen.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });
}
