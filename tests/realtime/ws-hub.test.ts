import { describe, expect, it } from "vitest";
import { WsHub, type HubSocket } from "../../src/realtime/ws-hub";

const OPEN = 1;
const CLOSED = 3;

function socket(readyState = OPEN) {
  const recebidos: unknown[] = [];
  const s: HubSocket & { recebidos: unknown[] } = {
    readyState,
    OPEN,
    send: (data: string) => recebidos.push(JSON.parse(data)),
    recebidos,
  };
  return s;
}

describe("WsHub", () => {
  it("evento de chamado vai para o dono e para a equipe, nunca para outro aluno", () => {
    const hub = new WsHub();
    const dono = socket();
    const outroAluno = socket();
    const secretaria = socket();
    const tecnico = socket();
    const admin = socket();
    hub.add("aluno-1", "USUARIO", dono);
    hub.add("aluno-2", "USUARIO", outroAluno);
    hub.add("sec-1", "BACKOFFICE", secretaria);
    hub.add("tec-1", "TECNICO", tecnico);
    hub.add("adm-1", "ADMINISTRADOR", admin);

    hub.sendToTicketViewers("aluno-1", { type: "nova_mensagem", chamadoId: "c1" });

    expect(dono.recebidos).toEqual([{ type: "nova_mensagem", chamadoId: "c1" }]);
    expect(secretaria.recebidos).toHaveLength(1);
    expect(tecnico.recebidos).toHaveLength(1);
    expect(admin.recebidos).toHaveLength(1);
    expect(outroAluno.recebidos).toEqual([]);
  });

  it("sem dono conhecido, só a equipe recebe", () => {
    const hub = new WsHub();
    const aluno = socket();
    const sec = socket();
    hub.add("aluno-1", "USUARIO", aluno);
    hub.add("sec-1", "BACKOFFICE", sec);

    hub.sendToTicketViewers(undefined, { type: "nova_mensagem" });

    expect(aluno.recebidos).toEqual([]);
    expect(sec.recebidos).toHaveLength(1);
  });

  it("todas as abas do usuário recebem; fechar uma não derruba a outra (#122)", () => {
    const hub = new WsHub();
    const aba1 = socket();
    const aba2 = socket();
    hub.add("aluno-1", "USUARIO", aba1);
    hub.add("aluno-1", "USUARIO", aba2);
    expect(hub.count("aluno-1")).toBe(2);

    hub.sendToUsers(["aluno-1"], { n: 1 });
    expect(aba1.recebidos).toEqual([{ n: 1 }]);
    expect(aba2.recebidos).toEqual([{ n: 1 }]);

    hub.remove("aluno-1", aba1);
    expect(hub.count("aluno-1")).toBe(1);
    hub.sendToTicketViewers("aluno-1", { n: 2 });
    expect(aba1.recebidos).toHaveLength(1);
    expect(aba2.recebidos).toEqual([{ n: 1 }, { n: 2 }]);

    hub.remove("aluno-1", aba2);
    expect(hub.count("aluno-1")).toBe(0);
  });

  it("não envia para conexão fechada nem repete para usuário listado duas vezes", () => {
    const hub = new WsHub();
    const fechada = socket(CLOSED);
    const aberta = socket();
    hub.add("u1", "USUARIO", fechada);
    hub.add("u2", "USUARIO", aberta);

    hub.sendToUsers(["u1", "u2", "u2", "ninguem"], { ok: true });

    expect(fechada.recebidos).toEqual([]);
    expect(aberta.recebidos).toEqual([{ ok: true }]);
  });
});
