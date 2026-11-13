import { describe, expect, it } from "vitest";
import {
  STATUS_ATIVOS,
  STATUS_FINAIS,
  STATUS_PASSE_LEGIVEL,
  STATUS_PASSE_VALUES,
  allowedTransitions,
  canTransition,
  canUpdatePasse,
  canViewPasse,
  isFinal,
  requiresComment,
} from "../../../src/core/passe-escolar/passe-escolar.rules";
import type { StatusPasseEscolar } from "../../../src/core/passe-escolar/passe-escolar.rules";
import { buildPasseLinks, buildPasseCollectionLinks } from "../../../src/core/passe-escolar/passe-escolar.links";
import { cpfValido, PasseEscolarCreateSchema } from "../../../src/validators/passe-escolar";

const aluno = { id: "aluno-1", role: "USUARIO" as const };
const outroAluno = { id: "aluno-2", role: "USUARIO" as const };
const secretaria = { id: "sec-1", role: "BACKOFFICE" as const };

const ctx = (status: StatusPasseEscolar) => ({ status, ownerId: aluno.id });

describe("Passe Escolar — regras de etapa", () => {
  it("todo status tem texto legível e está classificado como ativo ou final", () => {
    for (const s of STATUS_PASSE_VALUES) {
      expect(STATUS_PASSE_LEGIVEL[s]).toBeTruthy();
      expect(STATUS_ATIVOS.includes(s)).not.toBe(STATUS_FINAIS.includes(s));
    }
    expect(isFinal("CONCLUIDO")).toBe(true);
    expect(isFinal("SOLICITADO")).toBe(false);
  });

  it("a secretaria cadastra no portal, pede correção ou indefere um pedido novo", () => {
    expect([...allowedTransitions(ctx("SOLICITADO"), secretaria)].sort()).toEqual(
      ["CADASTRADO_PORTAL", "INDEFERIDO", "PENDENTE_ALUNO"],
    );
  });

  it("o aluno só cancela enquanto a Fatec não lançou; depois informa as etapas da EMTU", () => {
    expect(allowedTransitions(ctx("SOLICITADO"), aluno)).toEqual(["CANCELADO"]);
    expect(allowedTransitions(ctx("PENDENTE_ALUNO"), aluno)).toEqual(["CANCELADO"]);
    expect([...allowedTransitions(ctx("CADASTRADO_PORTAL"), aluno)].sort()).toEqual(["CANCELADO", "REQUISITADO_EMTU"]);
    expect([...allowedTransitions(ctx("REQUISITADO_EMTU"), aluno)].sort()).toEqual(["CONCLUIDO", "INDEFERIDO"]);
  });

  it("o aluno não pode fazer o papel da Fatec", () => {
    expect(canTransition(ctx("SOLICITADO"), aluno, "CADASTRADO_PORTAL")).toBe(false);
    expect(canTransition(ctx("SOLICITADO"), aluno, "INDEFERIDO")).toBe(false);
  });

  it("status finais não mudam mais (exceto excluir um concluído do portal)", () => {
    expect(allowedTransitions(ctx("INDEFERIDO"), secretaria)).toEqual([]);
    expect(allowedTransitions(ctx("CANCELADO"), secretaria)).toEqual([]);
    expect(allowedTransitions(ctx("CONCLUIDO"), secretaria)).toEqual(["CANCELADO"]);
    expect(allowedTransitions(ctx("CONCLUIDO"), aluno)).toEqual([]);
  });

  it("outro aluno não vê nem mexe", () => {
    expect(canViewPasse(outroAluno, aluno.id)).toBe(false);
    expect(allowedTransitions(ctx("CADASTRADO_PORTAL"), outroAluno)).toEqual([]);
    expect(canUpdatePasse(ctx("SOLICITADO"), outroAluno)).toBe(false);
  });

  it("o aluno corrige os dados só antes do cadastro no portal", () => {
    expect(canUpdatePasse(ctx("SOLICITADO"), aluno)).toBe(true);
    expect(canUpdatePasse(ctx("PENDENTE_ALUNO"), aluno)).toBe(true);
    expect(canUpdatePasse(ctx("CADASTRADO_PORTAL"), aluno)).toBe(false);
    expect(canUpdatePasse(ctx("SOLICITADO"), secretaria)).toBe(false);
  });

  it("pendência e indeferimento exigem explicação", () => {
    expect(requiresComment("PENDENTE_ALUNO")).toBe(true);
    expect(requiresComment("INDEFERIDO")).toBe(true);
    expect(requiresComment("CADASTRADO_PORTAL")).toBe(false);
  });
});

describe("Passe Escolar — links HAL", () => {
  const passe = { id: "p1", status: "CADASTRADO_PORTAL", usuarioId: aluno.id };

  it("o aluno recebe um link `transition` por etapa permitida, com `name`", () => {
    const links = buildPasseLinks(passe, aluno);
    const transicoes = links.transition as { name?: string; method?: string; href: string }[];
    expect(transicoes.map((l) => l.name).sort()).toEqual(["CANCELADO", "REQUISITADO_EMTU"]);
    expect(transicoes[0].method).toBe("POST");
    expect(transicoes[0].href).toBe("/school-passes/p1/status");
    expect(links.update).toBeUndefined();
  });

  it("`update` aparece só quando o aluno ainda pode corrigir", () => {
    const links = buildPasseLinks({ ...passe, status: "PENDENTE_ALUNO" }, aluno);
    expect(links.update).toEqual({ href: "/school-passes/p1", method: "PATCH" });
  });

  it("a coleção oferece `create` ao aluno e `export` à equipe", () => {
    expect(buildPasseCollectionLinks(aluno).create).toBeDefined();
    expect(buildPasseCollectionLinks(aluno).export).toBeUndefined();
    expect(buildPasseCollectionLinks(secretaria).export).toBeDefined();
    expect(buildPasseCollectionLinks(secretaria).create).toBeUndefined();
  });
});

describe("Passe Escolar — validação", () => {
  it("confere os dígitos do CPF e rejeita sequências", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("529.982.247-26")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("123")).toBe(false);
  });

  const base = {
    modalidade: "MEIA_TARIFA",
    nomeCompleto: "Maria da Silva",
    rg: "12.345.678-9",
    cpf: "529.982.247-25",
    cep: "09500-000",
    municipioResidencia: "São Caetano do Sul",
    curso: "DSM",
    periodo: "Noite",
    mesConclusao: 12,
    anoConclusao: 2027,
  };

  it("normaliza CPF e CEP para só dígitos", () => {
    const r = PasseEscolarCreateSchema.safeParse({ body: base });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.body.cpf).toBe("52998224725");
      expect(r.data.body.cep).toBe("09500000");
      expect(r.data.body.tipo).toBe("NOVO");
      expect(r.data.body.declaraBaixaRenda).toBe(false);
    }
  });

  it("Passe Livre exige a declaração de renda", () => {
    const r = PasseEscolarCreateSchema.safeParse({ body: { ...base, modalidade: "PASSE_LIVRE" } });
    expect(r.success).toBe(false);
    const ok = PasseEscolarCreateSchema.safeParse({ body: { ...base, modalidade: "PASSE_LIVRE", declaraBaixaRenda: true } });
    expect(ok.success).toBe(true);
  });
});
