import { describe, it, expect } from "vitest";
import {
  REOPEN_WINDOW_DAYS,
  allowedTransitions,
  canArchiveTicket,
  canInteractWithTicket,
  canReopen,
  canTransition,
  canUnarchiveTicket,
  canUpdateTicket,
  canViewTicket,
  statusAfterReply,
} from "../../../src/core/tickets/ticket-rules";
import type { TicketContext, TicketStatus } from "../../../src/core/tickets/ticket-rules";
import type { Role } from "../../../src/hateoas";

const DONO = "aluno-1";
const AGORA = new Date("2026-10-10T12:00:00Z");
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000);

const viewer = (role: Role, id = "outro") => ({ id, role });
const aluno = viewer("USUARIO", DONO);
const outroAluno = viewer("USUARIO", "aluno-2");
const tecnico = viewer("TECNICO");
const admin = viewer("ADMINISTRADOR");

const chamado = (
  status: TicketStatus,
  closedAt: Date | null = null,
  archivedAt: Date | null = null,
): TicketContext => ({
  status,
  ownerId: DONO,
  closedAt,
  archivedAt,
});

const ORDEM: TicketStatus[] = ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"];
const ordenar = (lista: TicketStatus[]) => [...lista].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b));

describe("allowedTransitions: equipe (dentro do prazo)", () => {
  it.each<[TicketStatus, TicketStatus[]]>([
    ["ABERTO", ["EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"]],
    ["EM_ATENDIMENTO", ["AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"]],
    ["AGUARDANDO_USUARIO", ["EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"]],
    ["RESOLVIDO", ["EM_ATENDIMENTO", "ENCERRADO"]],
    ["ENCERRADO", ["EM_ATENDIMENTO"]],
  ])("em %s a equipe pode ir para %j", (status, esperado) => {
    expect(ordenar(allowedTransitions(chamado(status, diasAtras(1)), tecnico, AGORA))).toEqual(esperado);
  });

  it("administrador tem as mesmas transições da equipe", () => {
    expect(ordenar(allowedTransitions(chamado("ABERTO"), admin, AGORA))).toEqual([
      "EM_ATENDIMENTO",
      "RESOLVIDO",
      "ENCERRADO",
    ]);
  });
});

describe("allowedTransitions: dono (aluno, dentro do prazo)", () => {
  it.each<[TicketStatus, TicketStatus[]]>([
    ["ABERTO", []],
    ["EM_ATENDIMENTO", []],
    ["AGUARDANDO_USUARIO", []],
    ["RESOLVIDO", ["EM_ATENDIMENTO", "ENCERRADO"]],
    ["ENCERRADO", ["EM_ATENDIMENTO"]],
  ])("em %s o dono pode ir para %j", (status, esperado) => {
    expect(ordenar(allowedTransitions(chamado(status, diasAtras(1)), aluno, AGORA))).toEqual(esperado);
  });

  it("outro aluno não pode mudar nada", () => {
    for (const s of ORDEM) expect(allowedTransitions(chamado(s, diasAtras(1)), outroAluno, AGORA)).toEqual([]);
  });

  it("equipe que também é dona não repete transições", () => {
    const tecnicoDono = viewer("TECNICO", DONO);
    const lista = allowedTransitions(chamado("RESOLVIDO", diasAtras(1)), tecnicoDono, AGORA);
    expect(lista).toHaveLength(new Set(lista).size);
    expect(ordenar(lista)).toEqual(["EM_ATENDIMENTO", "ENCERRADO"]);
  });
});

describe("prazo de reabertura (30 dias)", () => {
  it("o prazo é de 30 dias", () => {
    expect(REOPEN_WINDOW_DAYS).toBe(30);
  });

  it.each<TicketStatus>(["RESOLVIDO", "ENCERRADO"])("em %s, dentro de 30 dias dono e equipe reabrem", (status) => {
    expect(canReopen(chamado(status, diasAtras(10)), aluno, AGORA)).toBe(true);
    expect(canReopen(chamado(status, diasAtras(10)), tecnico, AGORA)).toBe(true);
  });

  it("no 30º dia ainda pode reabrir (limite incluído)", () => {
    expect(canReopen(chamado("RESOLVIDO", diasAtras(30)), aluno, AGORA)).toBe(true);
  });

  it("depois de 30 dias ninguém reabre", () => {
    const vencido = chamado("RESOLVIDO", new Date(AGORA.getTime() - (30 * 24 * 60 * 60 * 1000 + 1)));
    for (const v of [aluno, tecnico, admin]) expect(canReopen(vencido, v, AGORA)).toBe(false);
  });

  it("depois do prazo ainda dá para encerrar um RESOLVIDO (só a reabertura vence)", () => {
    const vencido = chamado("RESOLVIDO", diasAtras(45));
    expect(canTransition(vencido, "ENCERRADO", tecnico, AGORA)).toBe(true);
    expect(canTransition(vencido, "EM_ATENDIMENTO", tecnico, AGORA)).toBe(false);
  });

  it("sem data de fechamento registrada, o prazo é tratado como aberto", () => {
    expect(canReopen(chamado("RESOLVIDO", null), aluno, AGORA)).toBe(true);
  });

  it("chamado que não está fechado não tem 'reabrir'", () => {
    for (const s of ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO"] as TicketStatus[]) {
      expect(canReopen(chamado(s), tecnico, AGORA)).toBe(false);
    }
  });

  it("outro aluno não reabre", () => {
    expect(canReopen(chamado("RESOLVIDO", diasAtras(1)), outroAluno, AGORA)).toBe(false);
  });
});

describe("canTransition", () => {
  it("permite uma transição válida e recusa uma inválida", () => {
    expect(canTransition(chamado("RESOLVIDO", diasAtras(1)), "ENCERRADO", aluno, AGORA)).toBe(true);
    expect(canTransition(chamado("ABERTO"), "ENCERRADO", aluno, AGORA)).toBe(false);
  });

  it("não permite ir para o mesmo status", () => {
    expect(canTransition(chamado("ABERTO"), "ABERTO", tecnico, AGORA)).toBe(false);
  });
});

describe("canViewTicket", () => {
  it("dono e equipe veem; outro aluno não", () => {
    expect(canViewTicket(aluno, DONO)).toBe(true);
    expect(canViewTicket(tecnico, DONO)).toBe(true);
    expect(canViewTicket(admin, DONO)).toBe(true);
    expect(canViewTicket(outroAluno, DONO)).toBe(false);
  });
});

describe("canInteractWithTicket (responder e anexar)", () => {
  it.each<TicketStatus>(["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO"])("em %s dono e equipe podem", (status) => {
    expect(canInteractWithTicket(chamado(status), aluno)).toBe(true);
    expect(canInteractWithTicket(chamado(status), tecnico)).toBe(true);
  });

  it.each<TicketStatus>(["RESOLVIDO", "ENCERRADO"])("em %s ninguém pode (é preciso reabrir)", (status) => {
    for (const v of [aluno, tecnico, admin]) expect(canInteractWithTicket(chamado(status), v)).toBe(false);
  });

  it("outro aluno nunca pode", () => {
    expect(canInteractWithTicket(chamado("ABERTO"), outroAluno)).toBe(false);
  });
});

describe("statusAfterReply", () => {
  it("dono responde em AGUARDANDO_USUARIO: volta para EM_ATENDIMENTO", () => {
    expect(statusAfterReply(chamado("AGUARDANDO_USUARIO"), aluno)).toBe("EM_ATENDIMENTO");
  });

  it("a equipe responder não muda o status", () => {
    expect(statusAfterReply(chamado("AGUARDANDO_USUARIO"), tecnico)).toBeUndefined();
  });

  it.each<TicketStatus>(["ABERTO", "EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"])(
    "dono responder em %s não muda o status",
    (status) => {
      expect(statusAfterReply(chamado(status), aluno)).toBeUndefined();
    },
  );
});

describe("arquivar", () => {
  it.each<TicketStatus>(ORDEM)("só ADMINISTRADOR arquiva (status %s)", (status) => {
    expect(canArchiveTicket(chamado(status), admin)).toBe(true);
    expect(canArchiveTicket(chamado(status), tecnico)).toBe(false);
    expect(canArchiveTicket(chamado(status), viewer("BACKOFFICE"))).toBe(false);
    expect(canArchiveTicket(chamado(status), aluno)).toBe(false);
  });

  it("não arquiva um chamado que já está arquivado", () => {
    expect(canArchiveTicket(chamado("ENCERRADO", null, diasAtras(1)), admin)).toBe(false);
  });

  it("só ADMINISTRADOR desarquiva, e só se estiver arquivado", () => {
    const arquivado = chamado("ENCERRADO", null, diasAtras(1));
    expect(canUnarchiveTicket(arquivado, admin)).toBe(true);
    expect(canUnarchiveTicket(arquivado, tecnico)).toBe(false);
    expect(canUnarchiveTicket(arquivado, aluno)).toBe(false);
    expect(canUnarchiveTicket(chamado("ENCERRADO"), admin)).toBe(false);
  });

  it("chamado arquivado é somente leitura: sem transições, sem reabrir, sem responder", () => {
    const arquivado = chamado("RESOLVIDO", diasAtras(1), diasAtras(1));
    for (const v of [aluno, tecnico, admin]) {
      expect(allowedTransitions(arquivado, v, AGORA)).toEqual([]);
      expect(canReopen(arquivado, v, AGORA)).toBe(false);
      expect(canInteractWithTicket(arquivado, v)).toBe(false);
    }
  });

  it("chamado arquivado continua visível para dono e equipe", () => {
    expect(canViewTicket(aluno, DONO)).toBe(true);
    expect(canViewTicket(tecnico, DONO)).toBe(true);
  });
});

describe("canUpdateTicket", () => {
  it("só a equipe edita", () => {
    expect(canUpdateTicket(chamado("ABERTO"), tecnico)).toBe(true);
    expect(canUpdateTicket(chamado("ABERTO"), admin)).toBe(true);
    expect(canUpdateTicket(chamado("ABERTO"), viewer("BACKOFFICE"))).toBe(true);
    expect(canUpdateTicket(chamado("ABERTO"), aluno)).toBe(false);
    expect(canUpdateTicket(chamado("ABERTO"), outroAluno)).toBe(false);
  });

  it("ninguém edita um chamado ENCERRADO", () => {
    for (const v of [aluno, tecnico, admin]) expect(canUpdateTicket(chamado("ENCERRADO"), v)).toBe(false);
  });

  it("ninguém edita um chamado arquivado", () => {
    const arquivado = chamado("EM_ATENDIMENTO", null, diasAtras(1));
    for (const v of [aluno, tecnico, admin]) expect(canUpdateTicket(arquivado, v)).toBe(false);
  });
});