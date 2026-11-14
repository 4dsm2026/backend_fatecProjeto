import { describe, expect, it } from "vitest";
import {
  CURSO_NAO_INFORMADO,
  aceitaRespostas,
  allowedTransitions,
  canEditPesquisa,
  canManagePesquisa,
  canViewResultados,
  cursoDoAluno,
  cursoNoPublico,
  lerCursos,
  proximoSemestre,
  semestreAtual,
  semestreValido,
} from "../../../src/core/pesquisas/pesquisas.rules";
import { buildPesquisaCollectionLinks, buildPesquisaLinks } from "../../../src/core/pesquisas/pesquisas.links";
import { MODELO_CPA } from "../../../src/core/pesquisas/pesquisas.modelo";
import { validarRespostas } from "../../../src/core/pesquisas/pesquisas.service";
import { PesquisaCreateSchema } from "../../../src/validators/pesquisas";

const admin = { id: "adm", role: "ADMINISTRADOR" as const };
const coordenador = { id: "coord", role: "BACKOFFICE" as const };
const aluno = { id: "alu", role: "USUARIO" as const };

describe("Pesquisa CPA — semestre", () => {
  it("valida o formato AAAA-1 / AAAA-2", () => {
    expect(semestreValido("2026-2")).toBe(true);
    expect(semestreValido("2026-3")).toBe(false);
    expect(semestreValido("26-1")).toBe(false);
  });

  it("calcula o semestre atual e o próximo", () => {
    expect(semestreAtual(new Date(2026, 5, 30))).toBe("2026-1");
    expect(semestreAtual(new Date(2026, 6, 1))).toBe("2026-2");
    expect(proximoSemestre("2026-1")).toBe("2026-2");
    expect(proximoSemestre("2026-2")).toBe("2027-1");
  });
});

describe("Pesquisa CPA — papéis e estados", () => {
  it("só o administrador gerencia; toda a equipe vê resultados; aluno, nenhum dos dois", () => {
    expect(canManagePesquisa(admin)).toBe(true);
    expect(canManagePesquisa(coordenador)).toBe(false);
    expect(canViewResultados(coordenador)).toBe(true);
    expect(canViewResultados(aluno)).toBe(false);
  });

  it("rascunho abre, aberta encerra, encerrada reabre", () => {
    expect(allowedTransitions("RASCUNHO", admin)).toEqual(["ABERTA"]);
    expect(allowedTransitions("ABERTA", admin)).toEqual(["ENCERRADA"]);
    expect(allowedTransitions("ENCERRADA", admin)).toEqual(["ABERTA"]);
    expect(allowedTransitions("RASCUNHO", coordenador)).toEqual([]);
  });

  it("só rascunho é editável", () => {
    expect(canEditPesquisa("RASCUNHO", admin)).toBe(true);
    expect(canEditPesquisa("ABERTA", admin)).toBe(false);
    expect(canEditPesquisa("RASCUNHO", coordenador)).toBe(false);
  });

  it("aceita respostas só aberta e dentro do prazo", () => {
    const agora = new Date("2026-11-13T12:00:00Z");
    expect(aceitaRespostas({ status: "ABERTA", fechaEm: null }, agora)).toBe(true);
    expect(aceitaRespostas({ status: "ABERTA", fechaEm: new Date("2026-11-14T00:00:00Z") }, agora)).toBe(true);
    expect(aceitaRespostas({ status: "ABERTA", fechaEm: new Date("2026-11-13T11:00:00Z") }, agora)).toBe(false);
    expect(aceitaRespostas({ status: "RASCUNHO", fechaEm: null }, agora)).toBe(false);
    expect(aceitaRespostas({ status: "ENCERRADA", fechaEm: null }, agora)).toBe(false);
  });
});

describe("Pesquisa CPA — curso e público", () => {
  it("o curso do aluno é o do cadastro; senão, o que ele informou", () => {
    expect(cursoDoAluno({ cursoNome: " DSM ", curso: "outro" })).toBe("DSM");
    expect(cursoDoAluno({ cursoNome: null, curso: "COMEX" })).toBe("COMEX");
    expect(cursoDoAluno({})).toBe(CURSO_NAO_INFORMADO);
  });

  it("cursos null ou vazio = todos", () => {
    expect(cursoNoPublico(null, "DSM")).toBe(true);
    expect(cursoNoPublico([], "DSM")).toBe(true);
    expect(cursoNoPublico(["DSM"], "DSM")).toBe(true);
    expect(cursoNoPublico(["DSM"], "COMEX")).toBe(false);
    expect(lerCursos(["DSM", "", 3])).toEqual(["DSM"]);
    expect(lerCursos(null)).toBeNull();
    expect(lerCursos([])).toBeNull();
  });
});

describe("Pesquisa CPA — links HAL", () => {
  const base = { id: "p1", status: "ABERTA" as const, aceitaRespostas: true };

  it("o aluno recebe `respond` só enquanto pode responder", () => {
    expect(buildPesquisaLinks({ ...base, respondida: false }, aluno).respond).toEqual({ href: "/surveys/p1/responses", method: "POST" });
    expect(buildPesquisaLinks({ ...base, respondida: true }, aluno).respond).toBeUndefined();
    expect(buildPesquisaLinks({ ...base, aceitaRespostas: false, respondida: false }, aluno).respond).toBeUndefined();
    expect(buildPesquisaLinks({ ...base, respondida: false }, aluno).results).toBeUndefined();
  });

  it("o administrador recebe transição, cópia e resultados; edição só em rascunho", () => {
    const aberta = buildPesquisaLinks(base, admin);
    expect((aberta.transition as { name?: string }[]).map((l) => l.name)).toEqual(["ENCERRADA"]);
    expect(aberta.copy).toBeDefined();
    expect(aberta.results).toBeDefined();
    expect(aberta.update).toBeUndefined();
    expect(aberta.respond).toBeUndefined();

    const rascunho = buildPesquisaLinks({ ...base, status: "RASCUNHO", aceitaRespostas: false }, admin);
    expect(rascunho.update).toBeDefined();
    expect(rascunho.delete).toBeDefined();
    expect(rascunho.results).toBeUndefined();
  });

  it("a coordenação vê resultados mas não gerencia", () => {
    const links = buildPesquisaLinks(base, coordenador);
    expect(links.results).toBeDefined();
    expect(links.transition).toBeUndefined();
    expect(links.copy).toBeUndefined();
    expect(buildPesquisaCollectionLinks(coordenador).create).toBeUndefined();
    expect(buildPesquisaCollectionLinks(coordenador).courses).toBeDefined();
    expect(buildPesquisaCollectionLinks(admin).create).toBeDefined();
  });
});

describe("Pesquisa CPA — validação", () => {
  it("o modelo da CPA passa na validação de criação", () => {
    const r = PesquisaCreateSchema.safeParse({ body: { titulo: "Pesquisa CPA 2026-2", semestre: "2026-2", perguntas: MODELO_CPA } });
    expect(r.success).toBe(true);
  });

  it("múltipla escolha precisa de 2 opções distintas", () => {
    const criar = (opcoes: string[]) =>
      PesquisaCreateSchema.safeParse({
        body: { titulo: "Teste", semestre: "2026-2", perguntas: [{ texto: "Qual?", tipo: "MULTIPLA", opcoes }] },
      }).success;
    expect(criar(["A"])).toBe(false);
    expect(criar(["A", "A"])).toBe(false);
    expect(criar(["A", "B"])).toBe(true);
  });

  const perguntas = [
    { id: "q1", ordem: 1, secao: null, texto: "Nota", tipo: "ESCALA", opcoes: null, obrigatoria: true },
    { id: "q2", ordem: 2, secao: null, texto: "Opção", tipo: "MULTIPLA", opcoes: ["Sim", "Não"], obrigatoria: true },
    { id: "q3", ordem: 3, secao: null, texto: "Livre", tipo: "TEXTO", opcoes: null, obrigatoria: false },
  ];

  it("aceita respostas válidas, apara textos e ignora chaves desconhecidas", () => {
    expect(validarRespostas(perguntas, { q1: 4, q2: "Sim", q3: "  melhorar o wi-fi  ", outra: "x" })).toEqual({
      q1: 4,
      q2: "Sim",
      q3: "melhorar o wi-fi",
    });
    // 0 = não sei; texto opcional em branco não é guardado
    expect(validarRespostas(perguntas, { q1: 0, q2: "Não", q3: "" })).toEqual({ q1: 0, q2: "Não" });
  });

  it("rejeita obrigatória em branco, nota fora da escala e opção inexistente", () => {
    const erros = (respostas: Record<string, number | string | null>) => {
      try {
        validarRespostas(perguntas, respostas);
        return [];
      } catch (e) {
        return ((e as { errors?: { field: string }[] }).errors ?? []).map((x) => x.field);
      }
    };
    expect(erros({ q2: "Sim" })).toEqual(["respostas.q1"]);
    expect(erros({ q1: 6, q2: "Sim" })).toEqual(["respostas.q1"]);
    expect(erros({ q1: 3, q2: "Talvez" })).toEqual(["respostas.q2"]);
    expect(erros({ q1: "3", q2: "Sim" })).toEqual(["respostas.q1"]);
  });
});
