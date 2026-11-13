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
let outroAlunoToken: string;
let staffToken: string;

const ALUNO_ID = "user-id-001"; // sub padrão do makeUserToken
const STAFF_ID = "admin-id-001";
const ANO = new Date().getFullYear();

const corpoValido = {
  modalidade: "MEIA_TARIFA",
  nomeCompleto: "Maria da Silva",
  rg: "12.345.678-9",
  cpf: "529.982.247-25",
  cep: "09500-000",
  municipioResidencia: "São Caetano do Sul",
  curso: "Desenvolvimento de Software Multiplataforma",
  periodo: "Noite",
  mesConclusao: 12,
  anoConclusao: ANO + 1,
};

function passeDoBanco(status = "SOLICITADO", extra: Record<string, unknown> = {}) {
  return {
    id: "passe_1",
    usuarioId: ALUNO_ID,
    anoReferencia: ANO,
    tipo: "NOVO",
    modalidade: "MEIA_TARIFA",
    status,
    nomeCompleto: "Maria da Silva",
    rg: "12.345.678-9",
    cpf: "52998224725",
    cep: "09500000",
    municipioResidencia: "São Caetano do Sul",
    curso: "DSM",
    periodo: "Noite",
    mesConclusao: 12,
    anoConclusao: ANO + 1,
    declaraBaixaRenda: false,
    observacaoAluno: null,
    orientacaoFatec: null,
    cadastradoPortalEm: null,
    cadastradoPorId: null,
    protocoloEmtu: null,
    encerradoEm: null,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    usuario: { id: ALUNO_ID, nome: "Maria", ra: "123", emailPessoal: "maria@x.com", curso: "DSM", turno: "Noite" },
    cadastradoPor: null,
    historico: [],
    ...extra,
  };
}

/** A secretaria é avisada pelos membros do setor "Secretaria". */
function secretariaComMembros() {
  prismaMock.setor.findFirst.mockResolvedValue({ id: "setor-sec" });
  prismaMock.usuarioSetor.findMany.mockResolvedValue([{ usuarioId: "sec-1" }, { usuarioId: "sec-2" }]);
  prismaMock.usuario.findMany.mockResolvedValue([{ id: "sec-1" }, { id: "sec-2" }]); // opt-in do notifyMany
  prismaMock.notificacao.createMany.mockResolvedValue({ count: 2 });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  alunoToken = makeUserToken();
  outroAlunoToken = makeUserToken({ sub: "user-id-002", email: "outro@test.com" });
  staffToken = makeAdminToken();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMocks();
});

describe("/school-passes — Passe Escolar (beta)", () => {
  it("GET /api oferece o link school-passes", async () => {
    const res = await app.inject({ method: "GET", url: "/api", headers: bearerAuth(alunoToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()._links["school-passes"]).toEqual({ href: "/school-passes", method: "GET" });
  });

  it("201 — o aluno pede o cadastro e a secretaria é avisada", async () => {
    prismaMock.passeEscolar.findFirst.mockResolvedValue(null);
    prismaMock.passeEscolar.create.mockResolvedValue({ id: "passe_1" });
    prismaMock.passeEscolar.findUnique.mockResolvedValue(passeDoBanco());
    secretariaComMembros();

    const res = await app.inject({
      method: "POST",
      url: "/school-passes",
      headers: bearerAuth(alunoToken),
      payload: corpoValido,
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe("/school-passes/passe_1");
    const body = res.json();
    expect(body.status).toBe("SOLICITADO");
    expect(body._links.self.href).toBe("/school-passes/passe_1");
    expect(body._links.update.method).toBe("PATCH");
    expect(body._links.transition.map((l: { name: string }) => l.name)).toEqual(["CANCELADO"]);

    const criado = prismaMock.passeEscolar.create.mock.calls[0][0].data;
    expect(criado.cpf).toBe("52998224725");
    expect(criado.cep).toBe("09500000");
    expect(criado.usuarioId).toBe(ALUNO_ID);
    expect(criado.anoReferencia).toBe(ANO);

    const notificados = prismaMock.notificacao.createMany.mock.calls[0][0].data.map((n: { usuarioId: string }) => n.usuarioId);
    expect(notificados.sort()).toEqual(["sec-1", "sec-2"]);
  });

  it("400 — CPF com dígito verificador errado", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/school-passes",
      headers: bearerAuth(alunoToken),
      payload: { ...corpoValido, cpf: "529.982.247-26" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.some((e: { field: string }) => e.field.endsWith("cpf"))).toBe(true);
  });

  it("400 — Passe Livre sem a declaração de renda", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/school-passes",
      headers: bearerAuth(alunoToken),
      payload: { ...corpoValido, modalidade: "PASSE_LIVRE" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe("body.declaraBaixaRenda");
  });

  it("409 — já existe um pedido em andamento no ano", async () => {
    prismaMock.passeEscolar.findFirst.mockResolvedValue({ id: "passe_0", status: "CADASTRADO_PORTAL" });

    const res = await app.inject({
      method: "POST",
      url: "/school-passes",
      headers: bearerAuth(alunoToken),
      payload: corpoValido,
    });
    expect(res.statusCode).toBe(409);
    expect(prismaMock.passeEscolar.create).not.toHaveBeenCalled();
  });

  it("GET — o aluno só lista os próprios pedidos; a equipe filtra os ativos", async () => {
    prismaMock.passeEscolar.count.mockResolvedValue(1);
    prismaMock.passeEscolar.findMany.mockResolvedValue([passeDoBanco()]);

    const doAluno = await app.inject({ method: "GET", url: "/school-passes", headers: bearerAuth(alunoToken) });
    expect(doAluno.statusCode).toBe(200);
    expect(doAluno.json()._embedded["school-passes"]).toHaveLength(1);
    expect(doAluno.json()._links.create).toBeDefined();
    expect(prismaMock.passeEscolar.findMany.mock.calls[0][0].where.usuarioId).toBe(ALUNO_ID);

    const daEquipe = await app.inject({
      method: "GET",
      url: `/school-passes?ativos=true&ano=${ANO}&search=Maria`,
      headers: bearerAuth(staffToken),
    });
    expect(daEquipe.statusCode).toBe(200);
    const where = prismaMock.passeEscolar.findMany.mock.calls[1][0].where;
    expect(where.usuarioId).toBeUndefined();
    expect(where.anoReferencia).toBe(ANO);
    expect(where.status.in).not.toContain("CONCLUIDO");
    expect(where.status.in).toContain("SOLICITADO");
    expect(where.OR).toHaveLength(3);
    expect(daEquipe.json()._links.export.href).toBe("/school-passes/export");
  });

  it("404 — outro aluno não vê o pedido", async () => {
    prismaMock.passeEscolar.findUnique.mockResolvedValue(passeDoBanco());
    const res = await app.inject({
      method: "GET",
      url: "/school-passes/passe_1",
      headers: bearerAuth(outroAlunoToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("a secretaria cadastra no portal; o aluno então pode informar a requisição na EMTU", async () => {
    prismaMock.passeEscolar.findUnique
      .mockResolvedValueOnce(passeDoBanco("SOLICITADO"))
      .mockResolvedValueOnce(passeDoBanco("CADASTRADO_PORTAL", { cadastradoPortalEm: new Date(), cadastradoPorId: STAFF_ID }));
    prismaMock.passeEscolar.update.mockResolvedValue({ id: "passe_1" });
    prismaMock.usuario.findMany.mockResolvedValue([{ id: ALUNO_ID }]);
    prismaMock.notificacao.createMany.mockResolvedValue({ count: 1 });

    const res = await app.inject({
      method: "POST",
      url: "/school-passes/passe_1/status",
      headers: bearerAuth(staffToken),
      payload: { status: "CADASTRADO_PORTAL" },
    });

    expect(res.statusCode).toBe(200);
    const data = prismaMock.passeEscolar.update.mock.calls[0][0].data;
    expect(data.status).toBe("CADASTRADO_PORTAL");
    expect(data.cadastradoPorId).toBe(STAFF_ID);
    expect(data.cadastradoPortalEm).toBeInstanceOf(Date);
    expect(data.historico.create).toMatchObject({ de: "SOLICITADO", para: "CADASTRADO_PORTAL", autorId: STAFF_ID });

    // Avisa o aluno, em linguagem de aluno
    const notif = prismaMock.notificacao.createMany.mock.calls[0][0].data[0];
    expect(notif.usuarioId).toBe(ALUNO_ID);
    expect(notif.mensagem).toContain("Cadastrado no portal da EMTU");
  });

  it("400 — pedir correção sem explicar o motivo", async () => {
    prismaMock.passeEscolar.findUnique.mockResolvedValue(passeDoBanco("SOLICITADO"));
    const res = await app.inject({
      method: "POST",
      url: "/school-passes/passe_1/status",
      headers: bearerAuth(staffToken),
      payload: { status: "PENDENTE_ALUNO" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe("comentario"); // erro do serviço, sem prefixo
    expect(prismaMock.passeEscolar.update).not.toHaveBeenCalled();
  });

  it("409 — o aluno não pode se cadastrar no portal sozinho", async () => {
    prismaMock.passeEscolar.findUnique.mockResolvedValue(passeDoBanco("SOLICITADO"));
    const res = await app.inject({
      method: "POST",
      url: "/school-passes/passe_1/status",
      headers: bearerAuth(alunoToken),
      payload: { status: "CADASTRADO_PORTAL" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("o aluno informa que requisitou na EMTU, com o número do formulário", async () => {
    prismaMock.passeEscolar.findUnique
      .mockResolvedValueOnce(passeDoBanco("CADASTRADO_PORTAL"))
      .mockResolvedValueOnce(passeDoBanco("REQUISITADO_EMTU", { protocoloEmtu: "F-2026-0001" }));
    prismaMock.passeEscolar.update.mockResolvedValue({ id: "passe_1" });
    secretariaComMembros();

    const res = await app.inject({
      method: "POST",
      url: "/school-passes/passe_1/status",
      headers: bearerAuth(alunoToken),
      payload: { status: "REQUISITADO_EMTU", protocoloEmtu: "F-2026-0001" },
    });

    expect(res.statusCode).toBe(200);
    expect(prismaMock.passeEscolar.update.mock.calls[0][0].data.protocoloEmtu).toBe("F-2026-0001");
    expect(res.json()._links.transition.map((l: { name: string }) => l.name).sort()).toEqual(["CONCLUIDO", "INDEFERIDO"]);
  });

  it("PATCH — corrigir um pedido pendente devolve para a fila da secretaria", async () => {
    prismaMock.passeEscolar.findUnique
      .mockResolvedValueOnce(passeDoBanco("PENDENTE_ALUNO", { orientacaoFatec: "CEP inválido" }))
      .mockResolvedValueOnce(passeDoBanco("SOLICITADO", { cep: "09510100" }));
    prismaMock.passeEscolar.update.mockResolvedValue({ id: "passe_1" });
    secretariaComMembros();

    const res = await app.inject({
      method: "PATCH",
      url: "/school-passes/passe_1",
      headers: bearerAuth(alunoToken),
      payload: { cep: "09510-100" },
    });

    expect(res.statusCode).toBe(200);
    const data = prismaMock.passeEscolar.update.mock.calls[0][0].data;
    expect(data.cep).toBe("09510100");
    expect(data.status).toBe("SOLICITADO");
    expect(data.orientacaoFatec).toBeNull();
    expect(data.historico.create.para).toBe("SOLICITADO");
  });

  it("409 — PATCH depois do cadastro no portal", async () => {
    prismaMock.passeEscolar.findUnique.mockResolvedValue(passeDoBanco("CADASTRADO_PORTAL"));
    const res = await app.inject({
      method: "PATCH",
      url: "/school-passes/passe_1",
      headers: bearerAuth(alunoToken),
      payload: { cep: "09510-100" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /export — CSV com BOM e `;`, só para a equipe", async () => {
    prismaMock.passeEscolar.findMany.mockResolvedValue([
      { ...passeDoBanco("SOLICITADO"), usuario: { ra: "123", emailPessoal: "maria@x.com" } },
    ]);

    const negado = await app.inject({ method: "GET", url: "/school-passes/export", headers: bearerAuth(alunoToken) });
    expect(negado.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: `/school-passes/export?ano=${ANO}`,
      headers: bearerAuth(staffToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`passe-escolar-${ANO}.csv`);
    const linhas = res.body.split("\r\n");
    expect(linhas[0].startsWith("﻿\"Nome completo\";\"RG\";\"CPF\"")).toBe(true);
    expect(linhas[1]).toContain('"52998224725"');
    expect(linhas[1]).toContain('"Pedido recebido pela Fatec"');
  });

  it("401 — sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/school-passes" });
    expect(res.statusCode).toBe(401);
  });
});
