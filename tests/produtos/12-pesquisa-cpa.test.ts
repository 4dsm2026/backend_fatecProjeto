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
let adminToken: string;
let coordToken: string;

const ALUNO_ID = "user-id-001";

const PERGUNTAS = [
  { id: "q1", pesquisaId: "pesq_1", ordem: 1, secao: "Curso", texto: "As disciplinas contribuem?", tipo: "ESCALA", opcoes: null, obrigatoria: true },
  { id: "q2", pesquisaId: "pesq_1", ordem: 2, secao: "Você", texto: "Pretende concluir?", tipo: "MULTIPLA", opcoes: ["Sim", "Não"], obrigatoria: true },
  { id: "q3", pesquisaId: "pesq_1", ordem: 3, secao: "Aberto", texto: "O que melhorar?", tipo: "TEXTO", opcoes: null, obrigatoria: false },
];

function pesquisa(status = "ABERTA", extra: Record<string, unknown> = {}) {
  return {
    id: "pesq_1",
    titulo: "Pesquisa CPA 2026-2",
    descricao: null,
    semestre: "2026-2",
    status,
    cursos: null,
    fechaEm: null,
    abertaEm: null,
    encerradaEm: null,
    criadoPorId: "admin-id-001",
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    perguntas: PERGUNTAS,
    _count: { respostas: 0, perguntas: PERGUNTAS.length },
    ...extra,
  };
}

function alunoDoCurso(cursoNome: string | null) {
  prismaMock.usuario.findUnique.mockResolvedValue({ cursoNome, curso: null, turno: "Noite" });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  alunoToken = makeUserToken();
  adminToken = makeAdminToken();
  coordToken = makeUserToken({ sub: "coord-1", email: "coord@test.com", role: "BACKOFFICE" });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMocks();
});

describe("/surveys — Pesquisa institucional CPA (beta)", () => {
  it("GET /api oferece o link surveys", async () => {
    const res = await app.inject({ method: "GET", url: "/api", headers: bearerAuth(alunoToken) });
    expect(res.json()._links.surveys).toEqual({ href: "/surveys", method: "GET" });
  });

  it("201 — o administrador cria a pesquisa do semestre pelo modelo da CPA", async () => {
    prismaMock.pesquisa.create.mockResolvedValue({ id: "pesq_1" });
    prismaMock.pesquisa.findUnique.mockResolvedValue(pesquisa("RASCUNHO"));

    const res = await app.inject({
      method: "POST",
      url: "/surveys",
      headers: bearerAuth(adminToken),
      payload: { titulo: "Pesquisa CPA 2026-2", semestre: "2026-2" },
    });

    expect(res.statusCode).toBe(201);
    const criadas = prismaMock.pesquisa.create.mock.calls[0][0].data.perguntas.create;
    expect(criadas.length).toBeGreaterThan(10);
    expect(criadas[0].ordem).toBe(1);
    const body = res.json();
    expect(body.status).toBe("RASCUNHO");
    expect(body._links.update).toBeDefined();
    expect(body._links.transition.map((l: { name: string }) => l.name)).toEqual(["ABERTA"]);
  });

  it("403 — coordenação e aluno não criam; 400 — semestre inválido", async () => {
    const corpo = { titulo: "Pesquisa CPA", semestre: "2026-2" };
    for (const token of [coordToken, alunoToken]) {
      const res = await app.inject({ method: "POST", url: "/surveys", headers: bearerAuth(token), payload: corpo });
      expect(res.statusCode).toBe(403);
    }
    const ruim = await app.inject({ method: "POST", url: "/surveys", headers: bearerAuth(adminToken), payload: { ...corpo, semestre: "2026-3" } });
    expect(ruim.statusCode).toBe(400);
  });

  it("abrir a pesquisa avisa só os alunos dos cursos do público", async () => {
    prismaMock.pesquisa.findUnique
      .mockResolvedValueOnce(pesquisa("RASCUNHO", { cursos: ["DSM"] }))
      .mockResolvedValueOnce(pesquisa("ABERTA", { cursos: ["DSM"] }));
    prismaMock.pesquisa.update.mockResolvedValue({ id: "pesq_1" });
    prismaMock.usuario.findMany
      .mockResolvedValueOnce([
        { id: "a1", cursoNome: "DSM", curso: null },
        { id: "a2", cursoNome: "COMEX", curso: null },
        { id: "a3", cursoNome: null, curso: "DSM" },
      ])
      .mockResolvedValueOnce([{ id: "a1" }, { id: "a3" }]); // opt-in do notifyMany
    prismaMock.notificacao.createMany.mockResolvedValue({ count: 2 });

    const res = await app.inject({
      method: "POST",
      url: "/surveys/pesq_1/status",
      headers: bearerAuth(adminToken),
      payload: { status: "ABERTA" },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.pesquisa.update.mock.calls[0][0].data.abertaEm).toBeInstanceOf(Date);
    expect(prismaMock.usuario.findMany.mock.calls[1][0].where.id.in).toEqual(["a1", "a3"]);
  });

  it("409 — não abre sem perguntas nem edita depois de aberta", async () => {
    prismaMock.pesquisa.findUnique.mockResolvedValueOnce(pesquisa("RASCUNHO", { perguntas: [] }));
    const abrir = await app.inject({ method: "POST", url: "/surveys/pesq_1/status", headers: bearerAuth(adminToken), payload: { status: "ABERTA" } });
    expect(abrir.statusCode).toBe(409);

    prismaMock.pesquisa.findUnique.mockResolvedValueOnce(pesquisa("ABERTA"));
    const editar = await app.inject({ method: "PATCH", url: "/surveys/pesq_1", headers: bearerAuth(adminToken), payload: { titulo: "Outro título" } });
    expect(editar.statusCode).toBe(409);
    expect(prismaMock.pesquisa.update).not.toHaveBeenCalled();
  });

  it("copiar para o próximo semestre cria um rascunho com as mesmas perguntas", async () => {
    prismaMock.pesquisa.findUnique
      .mockResolvedValueOnce(pesquisa("ENCERRADA", { cursos: ["DSM"] }))
      .mockResolvedValueOnce(pesquisa("RASCUNHO", { id: "pesq_2", semestre: "2027-1", titulo: "Pesquisa CPA 2027-1" }));
    prismaMock.pesquisa.create.mockResolvedValue({ id: "pesq_2" });

    const res = await app.inject({
      method: "POST",
      url: "/surveys/pesq_1/copies",
      headers: bearerAuth(adminToken),
      payload: { semestre: "2027-1" },
    });

    expect(res.statusCode).toBe(201);
    const data = prismaMock.pesquisa.create.mock.calls[0][0].data;
    expect(data.titulo).toBe("Pesquisa CPA 2027-1");
    expect(data.semestre).toBe("2027-1");
    expect(data.cursos).toEqual(["DSM"]);
    expect(data.perguntas.create.map((p: { texto: string }) => p.texto)).toEqual(PERGUNTAS.map((p) => p.texto));
    expect(res.headers.location).toBe("/surveys/pesq_2");
  });

  it("o aluno lista só as abertas do curso dele, com a marca de respondida", async () => {
    alunoDoCurso("DSM");
    prismaMock.pesquisa.findMany.mockResolvedValue([
      { ...pesquisa("ABERTA", { id: "todos" }), perguntas: undefined },
      { ...pesquisa("ABERTA", { id: "so-comex", cursos: ["COMEX"] }), perguntas: undefined },
      { ...pesquisa("ABERTA", { id: "so-dsm", cursos: ["DSM"] }), perguntas: undefined },
    ]);
    prismaMock.pesquisaParticipacao.findMany.mockResolvedValue([{ pesquisaId: "so-dsm" }]);

    const res = await app.inject({ method: "GET", url: "/surveys", headers: bearerAuth(alunoToken) });

    expect(res.statusCode).toBe(200);
    const itens = res.json()._embedded.surveys;
    expect(itens.map((p: { id: string }) => p.id)).toEqual(["todos", "so-dsm"]);
    expect(itens[0]._links.respond).toBeDefined();
    expect(itens[1].respondida).toBe(true);
    expect(itens[1]._links.respond).toBeUndefined();
    expect(prismaMock.pesquisa.findMany.mock.calls[0][0].where).toEqual({ status: "ABERTA" });
  });

  it("404 — aluno de outro curso não vê nem responde", async () => {
    alunoDoCurso("COMEX");
    prismaMock.pesquisa.findUnique.mockResolvedValue(pesquisa("ABERTA", { cursos: ["DSM"] }));

    const ver = await app.inject({ method: "GET", url: "/surveys/pesq_1", headers: bearerAuth(alunoToken) });
    expect(ver.statusCode).toBe(404);
    const responder = await app.inject({
      method: "POST",
      url: "/surveys/pesq_1/responses",
      headers: bearerAuth(alunoToken),
      payload: { respostas: { q1: 5, q2: "Sim" } },
    });
    expect(responder.statusCode).toBe(404);
  });

  it("201 — a resposta é guardada SEM o aluno; a participação, sem as respostas", async () => {
    alunoDoCurso("DSM");
    prismaMock.pesquisa.findUnique.mockResolvedValue(pesquisa("ABERTA"));
    prismaMock.pesquisaParticipacao.create.mockResolvedValue({ id: "part_1" });
    prismaMock.pesquisaResposta.create.mockResolvedValue({ id: "uuid" });

    const res = await app.inject({
      method: "POST",
      url: "/surveys/pesq_1/responses",
      headers: bearerAuth(alunoToken),
      payload: { respostas: { q1: 4, q2: "Sim", q3: " Wi-fi " } },
    });

    expect(res.statusCode).toBe(201);
    expect(prismaMock.pesquisaParticipacao.create.mock.calls[0][0].data).toEqual({ pesquisaId: "pesq_1", usuarioId: ALUNO_ID });
    const resposta = prismaMock.pesquisaResposta.create.mock.calls[0][0].data;
    expect(resposta).toEqual({ pesquisaId: "pesq_1", curso: "DSM", turno: "Noite", respostas: { q1: 4, q2: "Sim", q3: "Wi-fi" } });
    expect(JSON.stringify(resposta)).not.toContain(ALUNO_ID);
  });

  it("409 — segunda resposta do mesmo aluno; 409 — prazo vencido; 400 — obrigatória em branco", async () => {
    alunoDoCurso("DSM");
    const corpo = { respostas: { q1: 4, q2: "Sim" } };

    prismaMock.pesquisa.findUnique.mockResolvedValueOnce(pesquisa("ABERTA"));
    prismaMock.pesquisaParticipacao.create.mockRejectedValueOnce(Object.assign(new Error("Unique"), { code: "P2002" }));
    const dupla = await app.inject({ method: "POST", url: "/surveys/pesq_1/responses", headers: bearerAuth(alunoToken), payload: corpo });
    expect(dupla.statusCode).toBe(409);
    expect(prismaMock.pesquisaResposta.create).not.toHaveBeenCalled();

    prismaMock.pesquisa.findUnique.mockResolvedValueOnce(pesquisa("ABERTA", { fechaEm: new Date(Date.now() - 60_000) }));
    const vencida = await app.inject({ method: "POST", url: "/surveys/pesq_1/responses", headers: bearerAuth(alunoToken), payload: corpo });
    expect(vencida.statusCode).toBe(409);

    prismaMock.pesquisa.findUnique.mockResolvedValueOnce(pesquisa("ABERTA"));
    const incompleta = await app.inject({ method: "POST", url: "/surveys/pesq_1/responses", headers: bearerAuth(alunoToken), payload: { respostas: { q1: 4 } } });
    expect(incompleta.statusCode).toBe(400);
    expect(incompleta.json().errors[0].field).toBe("respostas.q2");
  });

  it("403 — a equipe não responde; o aluno não vê resultados", async () => {
    const equipe = await app.inject({ method: "POST", url: "/surveys/pesq_1/responses", headers: bearerAuth(adminToken), payload: { respostas: {} } });
    expect(equipe.statusCode).toBe(403);
    const aluno = await app.inject({ method: "GET", url: "/surveys/pesq_1/results", headers: bearerAuth(alunoToken) });
    expect(aluno.statusCode).toBe(403);
  });

  describe("resultados", () => {
    const resposta = (curso: string, q1: number, q2: string, q3?: string) => ({ curso, respostas: { q1, q2, ...(q3 ? { q3 } : {}) } });

    beforeEach(() => {
      prismaMock.pesquisa.findUnique.mockResolvedValue(pesquisa("ABERTA"));
      prismaMock.usuario.groupBy.mockResolvedValue([
        { cursoNome: "DSM", curso: null, _count: { _all: 40 } },
        { cursoNome: null, curso: "DSM", _count: { _all: 2 } },
        { cursoNome: "COMEX", curso: null, _count: { _all: 30 } },
      ]);
      prismaMock.pesquisaResposta.findMany.mockResolvedValue([
        resposta("DSM", 5, "Sim", "Wi-fi"),
        resposta("DSM", 4, "Sim"),
        resposta("DSM", 3, "Não", "Biblioteca"),
        resposta("DSM", 0, "Sim"),
        resposta("DSM", 4, "Sim"),
        resposta("COMEX", 1, "Não", "Cantina"),
      ]);
    });

    it("a coordenação vê participação por curso, média sem os 'não sei' e textos em ordem alfabética", async () => {
      const res = await app.inject({ method: "GET", url: "/surveys/pesq_1/results", headers: bearerAuth(coordToken) });

      expect(res.statusCode).toBe(200);
      const r = res.json();
      expect(r.suprimido).toBe(false);
      expect(r.totalRespostas).toBe(6);
      expect(r.totalElegiveis).toBe(72);
      expect(r.participacao).toEqual([
        { curso: "COMEX", elegiveis: 30, respondentes: 1 },
        { curso: "DSM", elegiveis: 42, respondentes: 5 },
      ]);

      const [q1, q2, q3] = r.perguntas;
      expect(q1.distribuicao).toEqual({ "1": 1, "2": 0, "3": 1, "4": 2, "5": 1 });
      expect(q1.naoSei).toBe(1);
      expect(q1.media).toBeCloseTo(3.4, 2); // (5+4+3+4+1)/5, sem o "não sei"
      expect(q2.opcoes).toEqual([{ opcao: "Sim", total: 4 }, { opcao: "Não", total: 2 }]);
      expect(q3.textos).toEqual(["Biblioteca", "Cantina", "Wi-fi"]);
    });

    it("recorte por curso com menos de 5 respostas é suprimido (anonimato)", async () => {
      const comex = await app.inject({ method: "GET", url: "/surveys/pesq_1/results?curso=COMEX", headers: bearerAuth(coordToken) });
      expect(comex.json()).toMatchObject({ suprimido: true, totalRespostas: 1, minimo: 5, perguntas: [] });

      const dsm = await app.inject({ method: "GET", url: "/surveys/pesq_1/results?curso=DSM", headers: bearerAuth(coordToken) });
      expect(dsm.json().suprimido).toBe(false);
      expect(dsm.json().totalElegiveis).toBe(42);
      expect(dsm.json().perguntas[2].textos).toEqual(["Biblioteca", "Wi-fi"]);
    });
  });

  it("GET /surveys/courses — cursos cadastrados com o número de alunos", async () => {
    prismaMock.usuario.groupBy.mockResolvedValue([
      { cursoNome: "DSM", curso: null, _count: { _all: 40 } },
      { cursoNome: null, curso: null, _count: { _all: 3 } },
    ]);
    const res = await app.inject({ method: "GET", url: "/surveys/courses", headers: bearerAuth(coordToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().cursos).toEqual([
      { curso: "Curso não informado", alunos: 3 },
      { curso: "DSM", alunos: 40 },
    ]);
  });
});
