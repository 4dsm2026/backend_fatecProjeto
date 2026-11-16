/**
 * Produto: Roteamento de chamados (#73, #74, #75)
 * Cobre: regras (CRUD, só admin, validação), hierarquia de e-mails do setor,
 * simulação e a abertura de chamado passando pela regra (setor + e-mail).
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const { enviados } = vi.hoisted(() => ({ enviados: [] as { to: string; subject: string }[] }));
vi.mock("../../src/lib/prisma");
vi.mock("../../src/jobs/cleanupAnexos", () => ({ scheduleCleanupAnexos: vi.fn() }));
vi.mock("../../src/config/mail", () => ({
  getMailDriver: () => ({
    send: async (m: { to: string; subject: string }) => {
      enviados.push(m);
    },
  }),
}));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import { prismaMock } from "../../src/lib/__mocks__/prisma";
import { makeTicket } from "../helpers/factories";
import { makeAdminToken, makeUserToken, bearerAuth } from "../helpers/auth";
import { resetMocks } from "../helpers/reset";

let app: FastifyInstance;
let admin: Record<string, string>;
let secretaria: Record<string, string>;
let aluno: Record<string, string>;

const REGRA = {
  id: "regra_manut_equipamento",
  nome: "Manutenção de equipamento",
  ordem: 10,
  ativo: true,
  categoriaChave: "manutencao",
  servicoChave: "manutencao-equipamento",
  setorId: "setor_aux_docentes",
  setorCopiaId: "setor_coordenacao",
  setor: { id: "setor_aux_docentes", nome: "Auxiliares Docentes" },
  setorCopia: { id: "setor_coordenacao", nome: "Coordenação" },
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  admin = bearerAuth(makeAdminToken());
  secretaria = bearerAuth(makeUserToken({ sub: "sec-1", role: "BACKOFFICE" }));
  aluno = bearerAuth(makeUserToken());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetMocks();
  enviados.length = 0;
  prismaMock.notificacao.create.mockResolvedValue({});
  prismaMock.usuario.findMany.mockResolvedValue([]);
  prismaMock.usuarioSetor.findMany.mockResolvedValue([]);
  prismaMock.historicoStatusChamado.create.mockResolvedValue({});
  prismaMock.chamado.findUnique.mockResolvedValue(null);
  prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(null);
  prismaMock.setorContato.findMany.mockResolvedValue([]);
});

describe("/admin/routing-rules", () => {
  it("só o administrador acessa (equipe e aluno: 403)", async () => {
    for (const headers of [secretaria, aluno]) {
      expect((await app.inject({ method: "GET", url: "/admin/routing-rules", headers })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/admin/routing-rules" })).statusCode).toBe(401);
  });

  it("lista as regras em _embedded com links de edição", async () => {
    prismaMock.regraRoteamento.findMany.mockResolvedValue([REGRA]);
    const res = await app.inject({ method: "GET", url: "/admin/routing-rules", headers: admin });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body._embedded["routing-rules"][0]).toMatchObject({ id: REGRA.id, setor: { nome: "Auxiliares Docentes" } });
    expect(body._embedded["routing-rules"][0]._links.update).toEqual({ href: "/admin/routing-rules/regra_manut_equipamento", method: "PATCH" });
    expect(body._links.preview.href).toBe("/admin/routing-preview");
  });

  it("201 — cria a regra, com Location", async () => {
    prismaMock.setor.count.mockResolvedValue(2);
    prismaMock.regraRoteamento.create.mockResolvedValue(REGRA);
    const res = await app.inject({
      method: "POST",
      url: "/admin/routing-rules",
      headers: admin,
      payload: { nome: REGRA.nome, ordem: 10, categoriaChave: "manutencao", servicoChave: "manutencao-equipamento", setorId: REGRA.setorId, setorCopiaId: REGRA.setorCopiaId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe("/admin/routing-rules/regra_manut_equipamento");
    expect(prismaMock.regraRoteamento.create.mock.calls[0][0].data).toMatchObject({ servicoChave: "manutencao-equipamento", setorCopiaId: "setor_coordenacao" });
  });

  it("400 — sem categoria nem serviço, ou cópia igual ao destino", async () => {
    const semChave = await app.inject({ method: "POST", url: "/admin/routing-rules", headers: admin, payload: { nome: "Tudo", setorId: "s1" } });
    expect(semChave.statusCode).toBe(400);
    const mesmaCopia = await app.inject({
      method: "POST",
      url: "/admin/routing-rules",
      headers: admin,
      payload: { nome: "X", categoriaChave: "c", setorId: "s1", setorCopiaId: "s1" },
    });
    expect(mesmaCopia.statusCode).toBe(400);
    expect(prismaMock.regraRoteamento.create).not.toHaveBeenCalled();
  });

  it("400 — setor que não existe", async () => {
    prismaMock.setor.count.mockResolvedValue(0);
    const res = await app.inject({ method: "POST", url: "/admin/routing-rules", headers: admin, payload: { nome: "X", categoriaChave: "c", setorId: "nao-existe" } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH desliga a regra; 404 para regra inexistente", async () => {
    prismaMock.regraRoteamento.findUnique.mockResolvedValueOnce({ id: REGRA.id });
    prismaMock.setor.count.mockResolvedValue(0);
    prismaMock.regraRoteamento.update.mockResolvedValue({ ...REGRA, ativo: false });
    const ok = await app.inject({ method: "PATCH", url: `/admin/routing-rules/${REGRA.id}`, headers: admin, payload: { ativo: false } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ativo).toBe(false);

    prismaMock.regraRoteamento.findUnique.mockResolvedValueOnce(null);
    expect((await app.inject({ method: "PATCH", url: "/admin/routing-rules/x", headers: admin, payload: { ativo: false } })).statusCode).toBe(404);
  });

  it("DELETE responde 204", async () => {
    prismaMock.regraRoteamento.findUnique.mockResolvedValue({ id: REGRA.id });
    prismaMock.regraRoteamento.delete.mockResolvedValue(REGRA);
    expect((await app.inject({ method: "DELETE", url: `/admin/routing-rules/${REGRA.id}`, headers: admin })).statusCode).toBe(204);
  });
});

describe("/admin/sectors/:id/routing — hierarquia de e-mails", () => {
  const hierarquia = { id: "setor_administracao", nome: "Administração", prazoEscalonamentoHoras: 24, contatos: [] };

  it("GET devolve prazo, contatos e link de edição", async () => {
    prismaMock.setor.findUnique.mockResolvedValue(hierarquia);
    const res = await app.inject({ method: "GET", url: "/admin/sectors/setor_administracao/routing", headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prazoEscalonamentoHoras: 24, _links: { update: { method: "PUT" } } });
  });

  it("PUT recusa e-mail inválido e contato sem usuário nem e-mail", async () => {
    for (const contato of [{ nivel: "COPIA", email: "zeladoria" }, { nivel: "PRIMEIRO" }, { nivel: "PRIMEIRO", usuarioId: "u1", email: "a@b.com" }]) {
      const res = await app.inject({ method: "PUT", url: "/admin/sectors/setor_administracao/routing", headers: admin, payload: { prazoEscalonamentoHoras: 24, contatos: [contato] } });
      expect(res.statusCode).toBe(400);
    }
    expect(prismaMock.setorContato.createMany).not.toHaveBeenCalled();
  });

  it("PUT salva funcionário e e-mail avulso", async () => {
    prismaMock.setor.findUnique.mockResolvedValue(hierarquia);
    prismaMock.usuario.count.mockResolvedValue(1);
    const res = await app.inject({
      method: "PUT",
      url: "/admin/sectors/setor_administracao/routing",
      headers: admin,
      payload: { prazoEscalonamentoHoras: 8, contatos: [{ nivel: "PRIMEIRO", usuarioId: "adm1" }, { nivel: "SEGUNDO", email: "diretoria@fatec.sp.gov.br", nome: "Diretoria" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.setorContato.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("a equipe não edita a hierarquia", async () => {
    const res = await app.inject({ method: "PUT", url: "/admin/sectors/setor_administracao/routing", headers: secretaria, payload: { prazoEscalonamentoHoras: null, contatos: [] } });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/routing-preview", () => {
  it("diz para onde iria o chamado, sem enviar nada", async () => {
    prismaMock.regraRoteamento.findMany.mockResolvedValue([REGRA]);
    prismaMock.setor.findUnique.mockImplementation((async (a: { where: { id: string } }) => ({ id: a.where.id, nome: a.where.id })) as never);
    const res = await app.inject({ method: "POST", url: "/admin/routing-preview", headers: admin, payload: { servico: "manutencao-equipamento", categoria: "manutencao" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ setorId: "setor_aux_docentes", setorCopiaId: "setor_coordenacao", regraId: REGRA.id });
    expect(enviados).toHaveLength(0);
  });
});

describe("POST /tickets — passa pela regra de roteamento", () => {
  it("Equipamento com defeito vai para Auxiliares Docentes e avisa a hierarquia por e-mail", async () => {
    prismaMock.regraRoteamento.findMany.mockResolvedValue([REGRA]);
    prismaMock.setor.findUnique.mockResolvedValue({ nome: "Auxiliares Docentes" });
    prismaMock.setorContato.findMany.mockImplementation((async (a: { where: { setorId: string } }) =>
      a.where.setorId === "setor_aux_docentes"
        ? [{ nivel: "PRIMEIRO", usuarioId: null, email: "aux@fatec.sp.gov.br", nome: "Auxiliares", usuario: null }]
        : [{ nivel: "PRIMEIRO", usuarioId: null, email: "coord@fatec.sp.gov.br", nome: "Coordenação", usuario: null }]) as never);
    const ticket = makeTicket({ setorId: "setor_aux_docentes" });
    prismaMock.chamado.create.mockResolvedValueOnce(ticket);
    prismaMock.chamado.findFirst.mockResolvedValueOnce({ ...ticket, servico: null, criadoPor: null });

    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: aluno,
      payload: {
        titulo: "Projetor do laboratório 3 não liga",
        descricao: "O projetor do laboratório 3 não liga desde ontem",
        servicoId: "manutencao-equipamento",
        categoriaId: "manutencao",
        categoriaNome: "Manutenção",
        setorProvavel: "Auxiliares Docentes",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(prismaMock.chamado.create.mock.calls[0][0].data).toMatchObject({
      setorId: "setor_aux_docentes",
      regraRoteamentoId: REGRA.id,
      roteamentoMotivo: "Regra: Manutenção de equipamento",
    });
    expect(enviados.map((e) => e.to).sort()).toEqual(["aux@fatec.sp.gov.br", "coord@fatec.sp.gov.br"]);
  });
});
