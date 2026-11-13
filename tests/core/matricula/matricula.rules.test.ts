import { describe, expect, it } from "vitest";
import {
  MAX_TRANCAMENTOS,
  SITUACAO,
  allowedTransitions,
  avaliarPedido,
  canRespond,
  numeroDoSemestre,
  requiresComment,
  situacaoAposDeferir,
  situacaoNormalizada,
} from "../../../src/core/matricula/matricula.rules";
import { buildSolicitacaoCollectionLinks, buildSolicitacaoLinks } from "../../../src/core/matricula/matricula.links";
import { SolicitacaoCreateSchema } from "../../../src/validators/matricula";

const aluno = { id: "alu", role: "USUARIO" as const };
const outro = { id: "outro", role: "USUARIO" as const };
const secretaria = { id: "sec", role: "BACKOFFICE" as const };
const ctx = (status: Parameters<typeof allowedTransitions>[0]["status"]) => ({ status, ownerId: aluno.id });

describe("Matrícula — situação acadêmica", () => {
  it("normaliza o texto livre do cadastro", () => {
    expect(situacaoNormalizada(null)).toBe(SITUACAO.REGULAR);
    expect(situacaoNormalizada("Ativa")).toBe(SITUACAO.REGULAR);
    expect(situacaoNormalizada("TRANCADA (2026-1)")).toBe(SITUACAO.TRANCADA);
    expect(situacaoNormalizada("cancelada")).toBe(SITUACAO.CANCELADA);
    expect(situacaoAposDeferir("TRANCAMENTO")).toBe("Trancada");
    expect(situacaoAposDeferir("CANCELAMENTO")).toBe("Cancelada");
  });

  it("lê o número do semestre", () => {
    expect(numeroDoSemestre("1")).toBe(1);
    expect(numeroDoSemestre("1º semestre")).toBe(1);
    expect(numeroDoSemestre("4º")).toBe(4);
    expect(numeroDoSemestre("")).toBeNull();
    expect(numeroDoSemestre(null)).toBeNull();
  });
});

describe("Matrícula — o que bloqueia e o que só avisa", () => {
  it("bloqueia trancar matrícula já trancada, cancelada ou com o limite usado", () => {
    expect(avaliarPedido("TRANCAMENTO", { situacaoAcademica: "Trancada" }, 0).bloqueio).toMatch(/já está trancada/);
    expect(avaliarPedido("TRANCAMENTO", { situacaoAcademica: "Cancelada" }, 0).bloqueio).toMatch(/já está cancelada/);
    expect(avaliarPedido("TRANCAMENTO", {}, MAX_TRANCAMENTOS).bloqueio).toMatch(/limite de 2/);
    expect(avaliarPedido("CANCELAMENTO", { situacaoAcademica: "Cancelada" }, 0).bloqueio).toMatch(/já está cancelada/);
  });

  it("1º semestre e trancamento anterior só geram aviso para a Secretaria", () => {
    const r = avaliarPedido("TRANCAMENTO", { semestreAtual: "1º" }, 1);
    expect(r.bloqueio).toBeNull();
    expect(r.alertas).toHaveLength(2);
    expect(r.alertas[0]).toMatch(/1º semestre/);
  });

  it("cancelar com matrícula trancada é permitido, com aviso", () => {
    const r = avaliarPedido("CANCELAMENTO", { situacaoAcademica: "Trancada" }, 2);
    expect(r.bloqueio).toBeNull();
    expect(r.alertas).toEqual(["A matrícula está trancada no momento."]);
  });
});

describe("Matrícula — transições", () => {
  it("a Secretaria analisa, pede correção, defere ou indefere; finais não mudam", () => {
    expect(allowedTransitions(ctx("SOLICITADO"), secretaria)).toEqual(["EM_ANALISE", "PENDENTE_ALUNO", "DEFERIDO", "INDEFERIDO"]);
    expect(allowedTransitions(ctx("PENDENTE_ALUNO"), secretaria)).toEqual(["EM_ANALISE", "INDEFERIDO"]);
    expect(allowedTransitions(ctx("DEFERIDO"), secretaria)).toEqual([]);
  });

  it("o aluno só desiste enquanto não há decisão; outro aluno nada", () => {
    expect(allowedTransitions(ctx("EM_ANALISE"), aluno)).toEqual(["CANCELADO"]);
    expect(allowedTransitions(ctx("DEFERIDO"), aluno)).toEqual([]);
    expect(allowedTransitions(ctx("SOLICITADO"), outro)).toEqual([]);
  });

  it("pendência e indeferimento exigem explicação; só o dono responde pendência", () => {
    expect(requiresComment("PENDENTE_ALUNO")).toBe(true);
    expect(requiresComment("INDEFERIDO")).toBe(true);
    expect(requiresComment("DEFERIDO")).toBe(false);
    expect(canRespond(ctx("PENDENTE_ALUNO"), aluno)).toBe(true);
    expect(canRespond(ctx("EM_ANALISE"), aluno)).toBe(false);
    expect(canRespond(ctx("PENDENTE_ALUNO"), secretaria)).toBe(false);
  });

  it("links: transição por status, resposta só na pendência, ficha do aluno para a equipe", () => {
    const s = { id: "s1", status: "PENDENTE_ALUNO", usuarioId: aluno.id };
    const doAluno = buildSolicitacaoLinks(s, aluno);
    expect(doAluno.respond).toEqual({ href: "/enrollment-requests/s1/replies", method: "POST" });
    expect((doAluno.transition as { name?: string }[]).map((l) => l.name)).toEqual(["CANCELADO"]);
    expect(doAluno.student).toBeUndefined();
    expect(buildSolicitacaoLinks(s, secretaria).student).toEqual({ href: "/users/alu", method: "GET" });
    expect(buildSolicitacaoCollectionLinks(aluno).create).toBeDefined();
    expect(buildSolicitacaoCollectionLinks(secretaria).summary).toBeDefined();
    expect(buildSolicitacaoCollectionLinks(secretaria).create).toBeUndefined();
  });
});

describe("Matrícula — validação do pedido", () => {
  const ok = (body: object) => SolicitacaoCreateSchema.safeParse({ body }).success;

  it("cancelamento exige confirmar que é definitivo", () => {
    expect(ok({ tipo: "CANCELAMENTO", motivo: "FINANCEIRO" })).toBe(false);
    expect(ok({ tipo: "CANCELAMENTO", motivo: "FINANCEIRO", cienteDefinitivo: true })).toBe(true);
    expect(ok({ tipo: "TRANCAMENTO", motivo: "FINANCEIRO" })).toBe(true);
  });

  it('motivo "Outro" exige justificativa; motivo fora da lista é recusado', () => {
    expect(ok({ tipo: "TRANCAMENTO", motivo: "OUTRO" })).toBe(false);
    expect(ok({ tipo: "TRANCAMENTO", motivo: "OUTRO", justificativa: "Intercâmbio no exterior" })).toBe(true);
    expect(ok({ tipo: "TRANCAMENTO", motivo: "PREGUICA" })).toBe(false);
  });
});
