import { beforeEach, describe, expect, it } from "vitest";
import { assignTicket, changeStatus, createTicket } from "../_helpers/tickets";
import { ticketRequest } from "../tickets/fixtures";
import type { PrepareTicketFixtures, TicketFixtures, TicketResource } from "../tickets/fixtures";

/** Jornada independente: o prepare cria dados e sessões novos para este teste. */
export function registerJ1(prepare: PrepareTicketFixtures): void {
  describe("J1: ciclo de vida do chamado", () => {
    let f: TicketFixtures;
    beforeEach(async () => { f = await prepare(); });

    it("abre, atende, responde, resolve, reabre, encerra e arquiva", async () => {
      const created = await createTicket(f.ctx, f.aluno, { setorId: f.setorId });
      expect(created.status).toBe("ABERTO");
      expect(created.setorId).toBe(f.setorId);

      const queue = await ticketRequest(f.ctx, f.funcionario, `/tickets?setorId=${encodeURIComponent(f.setorId)}&page=0&size=100`);
      expect(queue.status).toBe(200);
      const listing = await queue.json() as { _embedded: { tickets: Array<{ id: string }> } };
      expect(listing._embedded.tickets.map((ticket) => ticket.id)).toContain(created.id);

      await assignTicket(f.ctx, f.funcionario, created.id, f.funcionario.userId);
      await changeStatus(f.ctx, f.funcionario, created.id, "EM_ATENDIMENTO");
      const reply = await ticketRequest(f.ctx, f.funcionario, `/tickets/${created.id}/messages`, {
        method: "POST", body: JSON.stringify({ conteudo: "Estamos atendendo sua solicitação." }),
      });
      expect(reply.status).toBe(201);
      expect((await reply.json()).conteudo).toBe("Estamos atendendo sua solicitação.");

      await changeStatus(f.ctx, f.funcionario, created.id, "RESOLVIDO");
      await changeStatus(f.ctx, f.aluno, created.id, "EM_ATENDIMENTO");
      // O aluno só pode encerrar após o chamado voltar a RESOLVIDO.
      await changeStatus(f.ctx, f.funcionario, created.id, "RESOLVIDO");
      await changeStatus(f.ctx, f.aluno, created.id, "ENCERRADO");

      const archive = await ticketRequest(f.ctx, f.admin, `/tickets/${created.id}`, {
        method: "PATCH", body: JSON.stringify({ arquivado: true }),
      });
      expect(archive.status).toBe(200);
      const final = await archive.json() as TicketResource;
      expect(final.status).toBe("ENCERRADO");
      expect(final.arquivadoEm).toBeTruthy();
      expect(final._links).not.toHaveProperty("reply");
      expect(final._links).not.toHaveProperty("reopen");
    });
  });
}
