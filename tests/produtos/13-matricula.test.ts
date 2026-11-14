import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import { makeAdminToken, makeUserToken, bearerAuth } from "../helpers/auth";
import { resetMocks } from "../helpers/reset";

vi.mock("../../src/lib/prisma");
vi.mock("../../src/jobs/cleanupAnexos", () => ({
  scheduleCleanupAnexos: vi.fn(),
}));

let app: FastifyInstance;
let alunoToken: string;
let outroToken: string;
let staffToken: string;

const ALUNO_ID = "user-id-001";
const STAFF_ID = "admin-id-001";

const ALUNO = {
  id: ALUNO_ID,
  nome: "Maria da Silva",
  ra: "123",
  emailPessoal: "maria@x.com",
  cursoNome: "DSM",
  curso: null,
  turno: "Noite",
  semestreAtual: "3",
  situacaoAcademica: null as string | null,
};

function solicitacao(status = "SOLICITADO", extra: Record<string, unknown> = {}) {
  return {
    id: "sol_1",
    usuarioId: ALUNO_ID,
    tipo: "TRANCAMENTO",
    status,
    semestre: "2026-2",
    motivo: "TRABALHO_HORARIO",
    justificativa: "Mudei de turno no trabalho",
    curso: "DSM",
    orientacaoFatec: null,
    decididoEm: null,
    decididoPorId: null,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    usuario: ALUNO,
    decididoPor: null,
    historico: [],
    ...extra,
  };
}

/** O aluno ainda não tem pedido aberto nem trancamento deferido. */
function alunoSemPedidos(situacaoAcademica: string | null = null, deferidos = 0) {
  prismaMock.usuario.findUnique.mockResolvedValue({ ...ALUNO, situacaoAcademica });
  prismaMock.solicitacaoMatricula.count.mockResolvedValue(deferidos);
  prismaMock.solicitacaoMatricula.findFirst.mockResolvedValue(null);
}

function secretariaComMembros() {
  prismaMock.setor.findFirst.mockResolvedValue({ id: "setor-sec" });
  prismaMock.usuarioSetor.findMany.mockResolvedValue([{ usuarioId: "sec-1" }]);
  prismaMock.usuario.findMany.mockResolvedValue([{ id: "sec-1" }]);
  prismaMock.notificacao.createMany.mockResolvedValue({ count: 1 });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  alunoToken = makeUserToken();
  outroToken = makeUserToken({ sub: "user-id-002", email: "outro@test.com" });
  staffToken = makeAdminToken();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMocks();
});

describe("/enrollment-requests — Trancamento e cancelamento (beta)", () => {
  it("GET /eligibility diz o que o aluno pode pedir e por quê", async () => {
    alunoSemPedidos(null, 2);
    const res = await app.inject({ method: "GET", url: "/enrollment-requests/eligibility", headers: bearerAuth(alunoToken) });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.podeTrancar).toBe(false);
    expect(r.bloqueioTrancamento).toMatch(/limite de 2/);
    expect(r.podeCancelar).toBe(true);
    expect(r.trancamentosDeferidos).toBe(2);
    expect(r._links.create).toBeDefined();
  });

  it("201 — o aluno pede trancamento; guarda o curso e avisa a Secretaria", async () => {
    alunoSemPedidos();
    prismaMock.solicitacaoMatricula.create.mockResolvedValue({ id: "sol_1" });
    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValue(solicitacao());
    secretariaComMembros();

    const res = await app.inject({
      method: "POST",
      url: "/enrollment-requests",
      headers: bearerAuth(alunoToken),
      payload: { tipo: "TRANCAMENTO", motivo: "TRABALHO_HORARIO", justificativa: "Mudei de turno no trabalho" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe("/enrollment-requests/sol_1");
    const data = prismaMock.solicitacaoMatricula.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ usuarioId: ALUNO_ID, tipo: "TRANCAMENTO", curso: "DSM", motivo: "TRABALHO_HORARIO" });
    expect(data.semestre).toMatch(/^\d{4}-[12]$/);
    expect(res.json()._links.transition.map((l: { name: string }) => l.name)).toEqual(["CANCELADO"]);
    expect(res.json().alertas).toEqual([]); // aluno não vê os alertas da Secretaria
    expect(prismaMock.notificacao.createMany.mock.calls[0][0].data[0].usuarioId).toBe("sec-1");
  });

  it("409 — já tem pedido aberto; 409 — matrícula cancelada; 400 — cancelar sem confirmar", async () => {
    alunoSemPedidos();
    prismaMock.solicitacaoMatricula.findFirst.mockResolvedValue({ id: "sol_0", tipo: "TRANCAMENTO", status: "EM_ANALISE" });
    const aberto = await app.inject({ method: "POST", url: "/enrollment-requests", headers: bearerAuth(alunoToken), payload: { tipo: "CANCELAMENTO", motivo: "FINANCEIRO", cienteDefinitivo: true } });
    expect(aberto.statusCode).toBe(409);
    expect(aberto.json().detail).toMatch(/em andamento/);

    alunoSemPedidos("Cancelada");
    const cancelada = await app.inject({ method: "POST", url: "/enrollment-requests", headers: bearerAuth(alunoToken), payload: { tipo: "TRANCAMENTO", motivo: "FINANCEIRO" } });
    expect(cancelada.statusCode).toBe(409);

    const semConfirmar = await app.inject({ method: "POST", url: "/enrollment-requests", headers: bearerAuth(alunoToken), payload: { tipo: "CANCELAMENTO", motivo: "FINANCEIRO" } });
    expect(semConfirmar.statusCode).toBe(400);
    expect(prismaMock.solicitacaoMatricula.create).not.toHaveBeenCalled();
  });

  it("403 — a equipe não abre pedido em nome do aluno", async () => {
    const res = await app.inject({ method: "POST", url: "/enrollment-requests", headers: bearerAuth(staffToken), payload: { tipo: "TRANCAMENTO", motivo: "FINANCEIRO" } });
    expect(res.statusCode).toBe(403);
  });

  it("404 — outro aluno não vê o pedido", async () => {
    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValue(solicitacao());
    const res = await app.inject({ method: "GET", url: "/enrollment-requests/sol_1", headers: bearerAuth(outroToken) });
    expect(res.statusCode).toBe(404);
  });

  it("a equipe vê os alertas para decidir (1º semestre)", async () => {
    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValue(solicitacao("SOLICITADO", { usuario: { ...ALUNO, semestreAtual: "1º" } }));
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(0);
    const res = await app.inject({ method: "GET", url: "/enrollment-requests/sol_1", headers: bearerAuth(staffToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().alertas[0]).toMatch(/1º semestre/);
    expect(res.json()._links.student.href).toBe(`/users/${ALUNO_ID}`);
  });

  it("deferir trancamento muda a situação do aluno para Trancada e avisa o aluno", async () => {
    prismaMock.solicitacaoMatricula.findUnique
      .mockResolvedValueOnce(solicitacao("EM_ANALISE"))
      .mockResolvedValueOnce(solicitacao("DEFERIDO"));
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(0);
    prismaMock.solicitacaoMatricula.update.mockResolvedValue({ id: "sol_1" });
    prismaMock.usuario.update.mockResolvedValue({ id: ALUNO_ID });
    prismaMock.usuario.findMany.mockResolvedValue([{ id: ALUNO_ID }]);
    prismaMock.notificacao.createMany.mockResolvedValue({ count: 1 });

    const res = await app.inject({
      method: "POST",
      url: "/enrollment-requests/sol_1/status",
      headers: bearerAuth(staffToken),
      payload: { status: "DEFERIDO", comentario: "Trancamento válido para 2026-2." },
    });

    expect(res.statusCode).toBe(200);
    const data = prismaMock.solicitacaoMatricula.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DEFERIDO", decididoPorId: STAFF_ID, orientacaoFatec: "Trancamento válido para 2026-2." });
    expect(data.historico.create).toMatchObject({ de: "EM_ANALISE", para: "DEFERIDO" });
    expect(prismaMock.usuario.update.mock.calls[0][0]).toMatchObject({ where: { id: ALUNO_ID }, data: { situacaoAcademica: "Trancada" } });
    expect(prismaMock.notificacao.createMany.mock.calls[0][0].data[0].mensagem).toMatch(/Pedido deferido/);
  });

  it("deferir cancelamento muda a situação para Cancelada", async () => {
    prismaMock.solicitacaoMatricula.findUnique
      .mockResolvedValueOnce(solicitacao("SOLICITADO", { tipo: "CANCELAMENTO" }))
      .mockResolvedValueOnce(solicitacao("DEFERIDO", { tipo: "CANCELAMENTO" }));
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(0);
    prismaMock.solicitacaoMatricula.update.mockResolvedValue({ id: "sol_1" });
    prismaMock.usuario.update.mockResolvedValue({ id: ALUNO_ID });

    const res = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/status", headers: bearerAuth(staffToken), payload: { status: "DEFERIDO" } });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.usuario.update.mock.calls[0][0].data).toEqual({ situacaoAcademica: "Cancelada" });
  });

  it("409 — não defere se o limite de trancamentos já foi atingido nesse meio-tempo", async () => {
    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValue(solicitacao("EM_ANALISE"));
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(2);
    const res = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/status", headers: bearerAuth(staffToken), payload: { status: "DEFERIDO" } });
    expect(res.statusCode).toBe(409);
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("400 — indeferir sem motivo; indeferir não muda a situação do aluno", async () => {
    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValue(solicitacao("EM_ANALISE"));
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(0);
    const semMotivo = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/status", headers: bearerAuth(staffToken), payload: { status: "INDEFERIDO" } });
    expect(semMotivo.statusCode).toBe(400);

    prismaMock.solicitacaoMatricula.update.mockResolvedValue({ id: "sol_1" });
    const indeferido = await app.inject({
      method: "POST",
      url: "/enrollment-requests/sol_1/status",
      headers: bearerAuth(staffToken),
      payload: { status: "INDEFERIDO", comentario: "Fora do prazo do calendário acadêmico." },
    });
    expect(indeferido.statusCode).toBe(200);
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
  });

  it("o aluno responde a pendência e o pedido volta para análise", async () => {
    prismaMock.solicitacaoMatricula.findUnique
      .mockResolvedValueOnce(solicitacao("PENDENTE_ALUNO"))
      .mockResolvedValueOnce(solicitacao("EM_ANALISE"));
    prismaMock.solicitacaoMatricula.update.mockResolvedValue({ id: "sol_1" });
    secretariaComMembros();

    const res = await app.inject({
      method: "POST",
      url: "/enrollment-requests/sol_1/replies",
      headers: bearerAuth(alunoToken),
      payload: { justificativa: "Segue a declaração da empresa com o novo horário." },
    });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.solicitacaoMatricula.update.mock.calls[0][0].data).toMatchObject({ status: "EM_ANALISE", justificativa: "Segue a declaração da empresa com o novo horário." });

    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValueOnce(solicitacao("EM_ANALISE"));
    const semPendencia = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/replies", headers: bearerAuth(alunoToken), payload: { justificativa: "Mais uma coisa" } });
    expect(semPendencia.statusCode).toBe(409);
  });

  it("o aluno desiste do pedido; a equipe é avisada", async () => {
    prismaMock.solicitacaoMatricula.findUnique
      .mockResolvedValueOnce(solicitacao("SOLICITADO"))
      .mockResolvedValueOnce(solicitacao("CANCELADO"));
    prismaMock.solicitacaoMatricula.update.mockResolvedValue({ id: "sol_1" });
    secretariaComMembros();

    const res = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/status", headers: bearerAuth(alunoToken), payload: { status: "CANCELADO" } });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.notificacao.createMany.mock.calls[0][0].data[0].mensagem).toMatch(/retirou o pedido/);

    prismaMock.solicitacaoMatricula.findUnique.mockResolvedValueOnce(solicitacao("SOLICITADO"));
    const deferirSozinho = await app.inject({ method: "POST", url: "/enrollment-requests/sol_1/status", headers: bearerAuth(alunoToken), payload: { status: "DEFERIDO" } });
    expect(deferirSozinho.statusCode).toBe(409);
  });

  it("GET — a equipe filtra a fila e a ficha do aluno; o aluno só vê os próprios", async () => {
    prismaMock.solicitacaoMatricula.count.mockResolvedValue(1);
    prismaMock.solicitacaoMatricula.findMany.mockResolvedValue([{ ...solicitacao(), historico: undefined }]);

    const fila = await app.inject({ method: "GET", url: "/enrollment-requests?abertos=true&tipo=TRANCAMENTO&curso=DSM&search=Maria", headers: bearerAuth(staffToken) });
    expect(fila.statusCode).toBe(200);
    const where = prismaMock.solicitacaoMatricula.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["SOLICITADO", "EM_ANALISE", "PENDENTE_ALUNO"]);
    expect(where).toMatchObject({ tipo: "TRANCAMENTO", curso: "DSM" });
    expect(where.OR).toHaveLength(2);
    expect(fila.json()._links.summary).toBeDefined();

    await app.inject({ method: "GET", url: `/enrollment-requests?usuarioId=${ALUNO_ID}`, headers: bearerAuth(staffToken) });
    expect(prismaMock.solicitacaoMatricula.findMany.mock.calls[1][0].where.usuarioId).toBe(ALUNO_ID);

    await app.inject({ method: "GET", url: "/enrollment-requests?usuarioId=outro&curso=DSM", headers: bearerAuth(alunoToken) });
    const doAluno = prismaMock.solicitacaoMatricula.findMany.mock.calls[2][0].where;
    expect(doAluno.usuarioId).toBe(ALUNO_ID);
    expect(doAluno.curso).toBeUndefined();
  });

  it("GET /summary — fila e deferidos por motivo e curso (só equipe)", async () => {
    prismaMock.solicitacaoMatricula.groupBy
      .mockResolvedValueOnce([{ status: "SOLICITADO", _count: { _all: 2 } }, { status: "PENDENTE_ALUNO", _count: { _all: 1 } }])
      .mockResolvedValueOnce([
        { tipo: "TRANCAMENTO", motivo: "TRABALHO_HORARIO", _count: { _all: 3 } },
        { tipo: "CANCELAMENTO", motivo: "FINANCEIRO", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { tipo: "TRANCAMENTO", curso: "DSM", _count: { _all: 3 } },
        { tipo: "CANCELAMENTO", curso: "COMEX", _count: { _all: 1 } },
      ]);

    const res = await app.inject({ method: "GET", url: "/enrollment-requests/summary?semestre=2026-2", headers: bearerAuth(staffToken) });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.totalEmAberto).toBe(3);
    expect(r.deferidos).toEqual({ TRANCAMENTO: 3, CANCELAMENTO: 1 });
    expect(r.porMotivo).toEqual([
      { motivo: "TRABALHO_HORARIO", rotulo: "Trabalho ou horário", TRANCAMENTO: 3, CANCELAMENTO: 0 },
      { motivo: "FINANCEIRO", rotulo: "Dificuldade financeira", TRANCAMENTO: 0, CANCELAMENTO: 1 },
    ]);
    expect(r.porCurso).toEqual([
      { curso: "COMEX", TRANCAMENTO: 0, CANCELAMENTO: 1 },
      { curso: "DSM", TRANCAMENTO: 3, CANCELAMENTO: 0 },
    ]);

    const aluno = await app.inject({ method: "GET", url: "/enrollment-requests/summary", headers: bearerAuth(alunoToken) });
    expect(aluno.statusCode).toBe(403);
  });
});

describe("GET /users — filtros de curso e situação acadêmica", () => {
  it("monta o filtro de curso (cursoNome, senão curso) e de situação", async () => {
    prismaMock.usuario.findMany.mockResolvedValue([]);
    prismaMock.usuario.count.mockResolvedValue(0);

    const res = await app.inject({ method: "GET", url: "/users?papel=USUARIO&curso=DSM&situacao=Trancada", headers: bearerAuth(staffToken) });
    expect(res.statusCode).toBe(200);
    const where = prismaMock.usuario.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { OR: [{ cursoNome: "DSM" }, { AND: [{ OR: [{ cursoNome: null }, { cursoNome: "" }] }, { curso: "DSM" }] }] },
      { situacaoAcademica: { startsWith: "Tranc" } },
    ]);
    expect(res.json()._links.self.href).toContain("situacao=Trancada");

    await app.inject({ method: "GET", url: "/users?papel=USUARIO&situacao=Regular", headers: bearerAuth(staffToken) });
    const regular = prismaMock.usuario.findMany.mock.calls[1][0].where.AND[0];
    expect(regular.OR[0]).toEqual({ situacaoAcademica: null });

    const ruim = await app.inject({ method: "GET", url: "/users?situacao=Ativa", headers: bearerAuth(staffToken) });
    expect(ruim.statusCode).toBe(400);
  });
});
