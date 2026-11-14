import { vi, describe, it, expect, beforeEach } from "vitest";

// Funções comuns (não vi.fn): o resetMocks() apagaria a implementação.
const { enviados, notificados } = vi.hoisted(() => ({
  enviados: [] as { to: string; subject: string; html: string }[],
  notificados: [] as { usuarios: string[]; titulo: string }[],
}));
vi.mock("../../../src/lib/prisma");
vi.mock("../../../src/env", async (original) => {
  const mod = await original<typeof import("../../../src/env")>();
  return { ...mod, env: { ...mod.env, APP_WEB_URL: "https://wf.exemplo/" } };
});
vi.mock("../../../src/config/mail", () => ({
  getMailDriver: () => ({
    send: async (m: { to: string; subject: string; html: string }) => {
      enviados.push(m);
    },
  }),
}));
vi.mock("../../../src/core/notifications/notify", () => ({
  notifyMany: async (_p: unknown, usuarios: string[], d: { titulo: string }) => {
    notificados.push({ usuarios, titulo: d.titulo });
  },
}));

import type { PrismaClient } from "@prisma/client";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import { resetMocks } from "../../helpers/reset";
import { avisarChegada, escalonarAtrasados, rotearChamado, salvarHierarquia, simular } from "../../../src/core/roteamento/roteamento.service";

const prisma = prismaMock as unknown as PrismaClient;
const admin = { id: "admin-1", role: "ADMINISTRADOR" as const };

const REGRAS = [
  { id: "regra_manut_equipamento", nome: "Manutenção de equipamento", ordem: 10, ativo: true, categoriaChave: "manutencao", servicoChave: "manutencao-equipamento", setorId: "aux", setorCopiaId: "coord" },
  { id: "regra_manut_predial", nome: "Manutenção predial", ordem: 20, ativo: true, categoriaChave: "manutencao", servicoChave: "manutencao-predial", setorId: "adm", setorCopiaId: null },
];

function usuario(id: string, extra: Record<string, unknown> = {}) {
  return { id, nome: `Pessoa ${id}`, emailEducacional: `${id}@fatec.sp.gov.br`, emailPessoal: null, ativo: true, deletadoEm: null, ...extra };
}

/** Contatos por setor/nível, no formato que o service seleciona. */
function contatosDe(mapa: Record<string, { nivel: string; usuario?: ReturnType<typeof usuario>; email?: string; nome?: string }[]>) {
  prismaMock.setorContato.findMany.mockImplementation((async (args: { where: { setorId: string; nivel: { in: string[] } } }) =>
    (mapa[args.where.setorId] ?? [])
      .filter((c) => args.where.nivel.in.includes(c.nivel))
      .map((c, i) => ({ id: `${args.where.setorId}-${i}`, nivel: c.nivel, usuarioId: c.usuario?.id ?? null, email: c.email ?? null, nome: c.nome ?? null, usuario: c.usuario ?? null }))) as never);
}

beforeEach(() => {
  resetMocks();
  enviados.length = 0;
  notificados.length = 0;
  prismaMock.regraRoteamento.findMany.mockResolvedValue(REGRAS);
  prismaMock.setor.findUnique.mockImplementation((async (a: { where: { id: string } }) => ({ id: a.where.id, nome: { aux: "Auxiliares Docentes", coord: "Coordenação", adm: "Administração" }[a.where.id] ?? a.where.id })) as never);
  prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(null);
});

describe("rotearChamado", () => {
  it("serviço com regra: vai para o setor da regra, com cópia", async () => {
    const d = await rotearChamado(prisma, { servico: "manutencao-equipamento", categoria: "manutencao" });
    expect(d).toEqual({ setorId: "aux", setorCopiaId: "coord", regraId: "regra_manut_equipamento", motivo: "Regra: Manutenção de equipamento" });
  });

  it("setor escolhido explicitamente vence as regras", async () => {
    const d = await rotearChamado(prisma, { setorIdExplicito: "ti", servico: "manutencao-equipamento" });
    expect(d.setorId).toBe("ti");
    expect(prismaMock.regraRoteamento.findMany).not.toHaveBeenCalled();
  });

  it("sem regra: setor provável pelo nome e, sem ele, a Secretaria", async () => {
    prismaMock.setor.findFirst.mockResolvedValueOnce({ id: "sec", nome: "Secretaria Acadêmica" });
    expect((await rotearChamado(prisma, { servico: "outro", setorProvavel: "Secretaria" })).motivo).toBe("Setor provável do serviço: Secretaria Acadêmica");

    prismaMock.setor.findFirst.mockResolvedValueOnce({ id: "sec", nome: "Secretaria Acadêmica" });
    expect(await rotearChamado(prisma, {})).toMatchObject({ setorId: "sec", regraId: null });
  });
});

describe("avisarChegada", () => {
  const chamado = { id: "ch1", protocolo: "TCK-1", titulo: "Projetor <queimado>", prioridade: "ALTA", setorId: "aux", organizacaoId: null, servicoNome: "Equipamento com defeito", solicitante: "Ana" };

  it("e-mail ao 1º nível, às cópias e ao 1º nível do setor em cópia; avisos no sistema só para usuários", async () => {
    contatosDe({
      aux: [
        { nivel: "PRIMEIRO", usuario: usuario("tec1") },
        { nivel: "SEGUNDO", usuario: usuario("chefe") },
        { nivel: "COPIA", email: "lab@fatec.sp.gov.br", nome: "Laboratório" },
      ],
      coord: [{ nivel: "PRIMEIRO", usuario: usuario("coord1") }, { nivel: "SEGUNDO", usuario: usuario("diretor") }],
    });

    const r = await avisarChegada(prisma, chamado, "coord", new Set(["tec1"]));

    expect(r.emails).toBe(3);
    expect(enviados.map((e) => e.to).sort()).toEqual(["coord1@fatec.sp.gov.br", "lab@fatec.sp.gov.br", "tec1@fatec.sp.gov.br"]);
    const doTecnico = enviados.find((e) => e.to === "tec1@fatec.sp.gov.br")!;
    expect(doTecnico.subject).toBe("Novo chamado TCK-1 para Auxiliares Docentes");
    expect(doTecnico.html).toContain("Projetor &lt;queimado&gt;");
    expect(doTecnico.html).toContain('<a href="https://wf.exemplo/admin/chamados/ch1">');
    expect(doTecnico.html).not.toContain("você está em cópia");
    expect(enviados.find((e) => e.to === "coord1@fatec.sp.gov.br")!.html).toContain("você está em cópia");
    // tec1 já recebeu o aviso padrão de chamado criado
    expect(notificados[0].usuarios).toEqual(["coord1"]);
  });

  it("ignora usuários inativos e não repete o mesmo e-mail", async () => {
    contatosDe({
      aux: [
        { nivel: "PRIMEIRO", usuario: usuario("tec1", { ativo: false }) },
        { nivel: "PRIMEIRO", usuario: usuario("tec2", { emailEducacional: null, emailPessoal: "tec2@gmail.com" }) },
        { nivel: "COPIA", email: "TEC2@gmail.com" },
      ],
    });
    await avisarChegada(prisma, chamado, null);
    expect(enviados.map((e) => e.to)).toEqual(["tec2@gmail.com"]);
  });

  it("modelo desabilitado na tela de Comunicações: não envia e-mail", async () => {
    contatosDe({ aux: [{ nivel: "PRIMEIRO", usuario: usuario("tec1") }] });
    prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue({ chave: "TICKET_ROUTED", assunto: "x", corpo: "y", habilitado: false });
    expect((await avisarChegada(prisma, chamado, null)).emails).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it("modelo salvo substitui o padrão", async () => {
    contatosDe({ aux: [{ nivel: "PRIMEIRO", usuario: usuario("tec1") }] });
    prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue({ chave: "TICKET_ROUTED", assunto: "[{{setor.nome}}] {{chamado.protocolo}}", corpo: "Oi {{destinatario.nome}}", habilitado: true });
    await avisarChegada(prisma, chamado, null);
    expect(enviados[0]).toMatchObject({ subject: "[Auxiliares Docentes] TCK-1", html: "Oi Pessoa tec1" });
  });

  it("nunca lança, mesmo com o banco falhando", async () => {
    prismaMock.setorContato.findMany.mockRejectedValue(new Error("db fora"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(avisarChegada(prisma, chamado, null)).resolves.toEqual({ emails: 0 });
  });
});

describe("escalonarAtrasados", () => {
  const agora = new Date(2026, 10, 18, 12); // quarta
  function candidato(extra: Record<string, unknown> = {}) {
    return {
      id: "ch1", protocolo: "TCK-1", titulo: "Lâmpada", prioridade: "MEDIA", status: "ABERTO", responsavelId: null, escalonadoEm: null,
      criadoEm: new Date(2026, 10, 16, 8), organizacaoId: null, setorId: "adm", catalogoCategoriaNome: "Manutenção",
      setor: { nome: "Administração", prazoEscalonamentoHoras: 24 }, ...extra,
    };
  }

  it("avisa o 2º nível uma vez e marca escalonadoEm", async () => {
    prismaMock.chamado.findMany.mockResolvedValue([candidato(), candidato({ id: "ch2", criadoEm: new Date(2026, 10, 18, 9) })]);
    prismaMock.chamado.updateMany.mockResolvedValue({ count: 1 });
    contatosDe({ adm: [{ nivel: "PRIMEIRO", usuario: usuario("adm1") }, { nivel: "SEGUNDO", usuario: usuario("diretor") }, { nivel: "SEGUNDO", email: "diretoria@fatec.sp.gov.br" }] });

    const r = await escalonarAtrasados(prisma, agora);

    expect(r).toEqual({ verificados: 2, escalonados: 1 });
    expect(prismaMock.chamado.updateMany).toHaveBeenCalledWith({ where: { id: "ch1", escalonadoEm: null }, data: { escalonadoEm: agora } });
    expect(enviados.map((e) => e.to).sort()).toEqual(["diretor@fatec.sp.gov.br", "diretoria@fatec.sp.gov.br"]);
    expect(enviados[0].subject).toBe("Chamado TCK-1 sem atendimento há 24 h úteis");
    expect(notificados).toEqual([{ usuarios: ["diretor"], titulo: "Chamado sem atendimento" }]);
  });

  it("outra instância já marcou: não avisa de novo", async () => {
    prismaMock.chamado.findMany.mockResolvedValue([candidato()]);
    prismaMock.chamado.updateMany.mockResolvedValue({ count: 0 });
    contatosDe({ adm: [{ nivel: "SEGUNDO", usuario: usuario("diretor") }] });
    expect((await escalonarAtrasados(prisma, agora)).escalonados).toBe(0);
    expect(enviados).toHaveLength(0);
  });
});

describe("salvarHierarquia e simular", () => {
  it("recusa aluno na hierarquia", async () => {
    prismaMock.setor.findUnique.mockResolvedValue({ id: "adm" });
    prismaMock.usuario.count.mockResolvedValue(0);
    await expect(
      salvarHierarquia(prisma, "adm", { prazoEscalonamentoHoras: 24, contatos: [{ nivel: "PRIMEIRO", usuarioId: "aluno-1" }] }, admin),
    ).rejects.toMatchObject({ detail: "Só funcionários (não alunos) podem estar na hierarquia de um setor." });
  });

  it("troca os contatos numa transação, com e-mail avulso em minúsculas", async () => {
    prismaMock.setor.findUnique.mockResolvedValue({ id: "adm", nome: "Administração", prazoEscalonamentoHoras: 8, contatos: [] });
    prismaMock.usuario.count.mockResolvedValue(1);
    await salvarHierarquia(
      prisma,
      "adm",
      { prazoEscalonamentoHoras: 8, contatos: [{ nivel: "PRIMEIRO", usuarioId: "adm1" }, { nivel: "COPIA", email: " Zeladoria@Fatec.SP.gov.br ", nome: " Zeladoria " }] },
      admin,
    );
    expect(prismaMock.setor.update).toHaveBeenCalledWith({ where: { id: "adm" }, data: { prazoEscalonamentoHoras: 8 } });
    expect(prismaMock.setorContato.deleteMany).toHaveBeenCalledWith({ where: { setorId: "adm" } });
    expect(prismaMock.setorContato.createMany).toHaveBeenCalledWith({
      data: [
        { setorId: "adm", nivel: "PRIMEIRO", usuarioId: "adm1", email: null, nome: null },
        { setorId: "adm", nivel: "COPIA", usuarioId: null, email: "zeladoria@fatec.sp.gov.br", nome: "Zeladoria" },
      ],
    });
  });

  it("simular mostra destino, cópia e quem recebe", async () => {
    contatosDe({ aux: [{ nivel: "PRIMEIRO", usuario: usuario("tec1") }], coord: [{ nivel: "PRIMEIRO", email: "coord@fatec.sp.gov.br" }] });
    const r = await simular(prisma, { servico: "manutencao-equipamento", categoria: "manutencao" }, admin);
    expect(r.setor?.nome).toBe("Auxiliares Docentes");
    expect(r.setorCopia?.nome).toBe("Coordenação");
    expect(r.emails.map((e) => e.email)).toEqual(["tec1@fatec.sp.gov.br", "coord@fatec.sp.gov.br"]);
    expect(enviados).toHaveLength(0);
  });

  it("só administrador", async () => {
    await expect(simular(prisma, {}, { id: "b", role: "BACKOFFICE" })).rejects.toMatchObject({ status: 403 });
  });
});
