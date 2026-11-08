import { describe, it, expect } from "vitest";
import { buildTicketLinks, toTicketContext, toTicketResource } from "../../../src/core/tickets/tickets.links";
import type { TicketRow } from "../../../src/core/tickets/tickets.links";
import {
  allowedTransitions,
  canArchiveTicket,
  canInteractWithTicket,
  canReopen,
  canUnarchiveTicket,
  canUpdateTicket,
  canViewTicket,
  isReopen,
} from "../../../src/core/tickets/ticket-rules";
import type { TicketStatus } from "../../../src/core/tickets/ticket-rules";
import type { Link, Role } from "../../../src/hateoas";

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
  opcoes: { encerrado?: Date | null; arquivado?: Date | null; id?: string } = {},
): TicketRow => ({
  id: opcoes.id ?? "clx1",
  status,
  criadoPorId: DONO,
  encerradoEm: opcoes.encerrado ?? null,
  arquivadoEm: opcoes.arquivado ?? null,
});

const ordenar = (lista: string[]) => [...lista].sort((a, b) => a.localeCompare(b));
const rels = (t: TicketRow, v: ReturnType<typeof viewer>) => ordenar(Object.keys(buildTicketLinks(t, v, AGORA)));
const nomesDeTransicao = (t: TicketRow, v: ReturnType<typeof viewer>): string[] => {
  const transition = buildTicketLinks(t, v, AGORA).transition;
  if (!transition) return [];
  return (Array.isArray(transition) ? transition : [transition]).map((l: Link) => l.name ?? "");
};

describe("buildTicketLinks: quais links aparecem em cada caso", () => {
  it.each<[string, TicketRow, ReturnType<typeof viewer>, string[]]>([
    ["ABERTO, aluno dono", chamado("ABERTO"), aluno, ["attachments", "collection", "messages", "reply", "self", "upload"]],
    ["ABERTO, outro aluno", chamado("ABERTO"), outroAluno, ["collection", "self"]],
    [
      "ABERTO, técnico",
      chamado("ABERTO"),
      tecnico,
      ["attachments", "collection", "messages", "reply", "self", "transition", "update", "upload"],
    ],
    [
      "ABERTO, administrador",
      chamado("ABERTO"),
      admin,
      ["archive", "attachments", "collection", "messages", "reply", "self", "transition", "update", "upload"],
    ],
    [
      "RESOLVIDO há 1 dia, aluno dono",
      chamado("RESOLVIDO", { encerrado: diasAtras(1) }),
      aluno,
      ["attachments", "collection", "messages", "reopen", "self", "transition"],
    ],
    [
      "RESOLVIDO há 1 dia, técnico",
      chamado("RESOLVIDO", { encerrado: diasAtras(1) }),
      tecnico,
      ["attachments", "collection", "messages", "reopen", "self", "transition", "update"],
    ],
    [
      "RESOLVIDO há 45 dias, aluno dono (sem reabrir)",
      chamado("RESOLVIDO", { encerrado: diasAtras(45) }),
      aluno,
      ["attachments", "collection", "messages", "self", "transition"],
    ],
    [
      "ENCERRADO há 1 dia, aluno dono",
      chamado("ENCERRADO", { encerrado: diasAtras(1) }),
      aluno,
      ["attachments", "collection", "messages", "reopen", "self"],
    ],
    [
      "ENCERRADO há 1 dia, técnico (sem update)",
      chamado("ENCERRADO", { encerrado: diasAtras(1) }),
      tecnico,
      ["attachments", "collection", "messages", "reopen", "self"],
    ],
    [
      "ENCERRADO há 1 dia, administrador",
      chamado("ENCERRADO", { encerrado: diasAtras(1) }),
      admin,
      ["archive", "attachments", "collection", "messages", "reopen", "self"],
    ],
    [
      "arquivado, aluno dono",
      chamado("RESOLVIDO", { encerrado: diasAtras(1), arquivado: diasAtras(1) }),
      aluno,
      ["attachments", "collection", "messages", "self"],
    ],
    [
      "arquivado, técnico",
      chamado("RESOLVIDO", { encerrado: diasAtras(1), arquivado: diasAtras(1) }),
      tecnico,
      ["attachments", "collection", "messages", "self"],
    ],
    [
      "arquivado, administrador",
      chamado("RESOLVIDO", { encerrado: diasAtras(1), arquivado: diasAtras(1) }),
      admin,
      ["attachments", "collection", "messages", "self", "unarchive"],
    ],
  ])("%s", (_nome, ticket, quem, esperado) => {
    expect(rels(ticket, quem)).toEqual(ordenar(esperado));
  });
});

describe("buildTicketLinks: transition[] (um link por transição permitida)", () => {
  it("técnico em ABERTO", () => {
    expect(ordenar(nomesDeTransicao(chamado("ABERTO"), tecnico))).toEqual(
      ordenar(["EM_ATENDIMENTO", "RESOLVIDO", "ENCERRADO"]),
    );
  });

  it("técnico em EM_ATENDIMENTO", () => {
    expect(ordenar(nomesDeTransicao(chamado("EM_ATENDIMENTO"), tecnico))).toEqual(
      ordenar(["AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"]),
    );
  });

  it("a reabertura não aparece em transition[] (ela tem o link reopen)", () => {
    const resolvido = chamado("RESOLVIDO", { encerrado: diasAtras(1) });
    expect(nomesDeTransicao(resolvido, tecnico)).toEqual(["ENCERRADO"]);
    expect(nomesDeTransicao(resolvido, aluno)).toEqual(["ENCERRADO"]);
  });
});

describe("buildTicketLinks: href e método de cada link", () => {
  const links = buildTicketLinks(chamado("ABERTO"), admin, AGORA);

  it("self e collection", () => {
    expect(links.self).toEqual({ href: "/tickets/clx1", method: "GET" });
    expect(links.collection).toEqual({ href: "/tickets", method: "GET" });
  });

  it("mensagens e anexos", () => {
    expect(links.messages).toEqual({ href: "/tickets/clx1/messages", method: "GET" });
    expect(links.reply).toEqual({ href: "/tickets/clx1/messages", method: "POST" });
    expect(links.attachments).toEqual({ href: "/tickets/clx1/attachments", method: "GET" });
    expect(links.upload).toEqual({ href: "/tickets/clx1/attachments", method: "POST" });
  });

  it("update e archive usam PATCH no próprio chamado", () => {
    expect(links.update).toEqual({ href: "/tickets/clx1", method: "PATCH" });
    expect(links.archive).toEqual({ href: "/tickets/clx1", method: "PATCH" });
  });

  it("reopen é um PATCH com name EM_ATENDIMENTO", () => {
    const reaberto = buildTicketLinks(chamado("RESOLVIDO", { encerrado: diasAtras(1) }), aluno, AGORA);
    expect(reaberto.reopen).toEqual({ href: "/tickets/clx1", method: "PATCH", name: "EM_ATENDIMENTO" });
  });

  it("o id é codificado na URL", () => {
    const l = buildTicketLinks(chamado("ABERTO", { id: "a/b" }), aluno, AGORA);
    expect(l.self).toEqual({ href: "/tickets/a%2Fb", method: "GET" });
    expect(l.reply).toEqual({ href: "/tickets/a%2Fb/messages", method: "POST" });
  });
});

describe("buildTicketLinks: link presente se e somente se a ação é permitida", () => {
  const temLink = (l: object, rel: string) => rel in l;

  it("vale para todas as combinações de status, papel, prazo e arquivamento", () => {
    const status: TicketStatus[] = ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"];
    const quemPede = [aluno, outroAluno, tecnico, admin];
    const fechamentos = [null, diasAtras(1), diasAtras(45)];
    const arquivamentos = [null, diasAtras(1)];

    for (const s of status) {
      for (const v of quemPede) {
        for (const encerrado of fechamentos) {
          for (const arquivado of arquivamentos) {
            const ticket = chamado(s, { encerrado, arquivado });
            const ctx = toTicketContext(ticket);
            const links = buildTicketLinks(ticket, v, AGORA);
            const onde = `${s} / ${v.role}:${v.id} / encerrado=${encerrado?.toISOString()} / arquivado=${arquivado?.toISOString()}`;

            expect(temLink(links, "messages"), `messages ${onde}`).toBe(canViewTicket(v, ctx.ownerId));
            expect(temLink(links, "attachments"), `attachments ${onde}`).toBe(canViewTicket(v, ctx.ownerId));
            expect(temLink(links, "reply"), `reply ${onde}`).toBe(canInteractWithTicket(ctx, v));
            expect(temLink(links, "upload"), `upload ${onde}`).toBe(canInteractWithTicket(ctx, v));
            expect(temLink(links, "update"), `update ${onde}`).toBe(canUpdateTicket(ctx, v));
            expect(temLink(links, "reopen"), `reopen ${onde}`).toBe(canReopen(ctx, v, AGORA));
            expect(temLink(links, "archive"), `archive ${onde}`).toBe(canArchiveTicket(ctx, v));
            expect(temLink(links, "unarchive"), `unarchive ${onde}`).toBe(canUnarchiveTicket(ctx, v));

            const esperadas = allowedTransitions(ctx, v, AGORA).filter((to) => !isReopen(s, to));
            expect(ordenar(nomesDeTransicao(ticket, v)), `transition ${onde}`).toEqual(ordenar(esperadas));
          }
        }
      }
    }
  });
});

describe("toTicketContext e toTicketResource", () => {
  it("toTicketContext traduz os campos do banco", () => {
    const ctx = toTicketContext(chamado("RESOLVIDO", { encerrado: diasAtras(2), arquivado: diasAtras(1) }));
    expect(ctx).toEqual({
      status: "RESOLVIDO",
      ownerId: DONO,
      closedAt: diasAtras(2),
      archivedAt: diasAtras(1),
    });
  });

  it("toTicketResource mantém os dados e acrescenta _links, sem alterar o original", () => {
    const original = { ...chamado("ABERTO"), titulo: "Sem acesso ao SIGA" };
    const recurso = toTicketResource(original, aluno, AGORA);
    expect(recurso.titulo).toBe("Sem acesso ao SIGA");
    expect(recurso._links.self).toEqual({ href: "/tickets/clx1", method: "GET" });
    expect(original).not.toHaveProperty("_links");
  });
});