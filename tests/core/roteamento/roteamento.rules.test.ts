import { describe, it, expect } from "vitest";
import { deveEscalonar, emailValido, escolherRegra, horasUteisEntre, type RegraLike } from "../../../src/core/roteamento/roteamento.rules";
import { renderizar } from "../../../src/core/roteamento/roteamento.emails";

function regra(extra: Partial<RegraLike>): RegraLike {
  return { id: "r", nome: "r", ordem: 100, ativo: true, categoriaChave: null, servicoChave: null, setorId: "s", setorCopiaId: null, ...extra };
}

describe("escolherRegra", () => {
  const porCategoria = regra({ id: "cat", categoriaChave: "manutencao", setorId: "adm", ordem: 1 });
  const porServico = regra({ id: "svc", categoriaChave: "manutencao", servicoChave: "manutencao-equipamento", setorId: "aux", ordem: 50 });

  it("a regra do serviço vence a da categoria, mesmo com ordem maior", () => {
    expect(escolherRegra([porCategoria, porServico], { categoria: "manutencao", servico: "manutencao-equipamento" })?.id).toBe("svc");
  });

  it("serviço sem regra própria cai na regra da categoria", () => {
    expect(escolherRegra([porCategoria, porServico], { categoria: "manutencao", servico: "manutencao-predial" })?.id).toBe("cat");
  });

  it("ignora regras inativas e regras sem categoria nem serviço", () => {
    const vazia = regra({ id: "vazia", ordem: 0 });
    const inativa = regra({ id: "off", categoriaChave: "manutencao", ativo: false, ordem: 0 });
    expect(escolherRegra([vazia, inativa], { categoria: "manutencao" })).toBeNull();
  });

  it("empate: menor ordem", () => {
    const a = regra({ id: "a", categoriaChave: "x", ordem: 20 });
    const b = regra({ id: "b", categoriaChave: "x", ordem: 10 });
    expect(escolherRegra([a, b], { categoria: "x" })?.id).toBe("b");
  });

  it("regra com serviço não casa com outra categoria", () => {
    expect(escolherRegra([porServico], { categoria: "outra", servico: "manutencao-equipamento" })).toBeNull();
  });
});

describe("horasUteisEntre", () => {
  it("conta só de segunda a sexta", () => {
    // sexta 20:00 → segunda 08:00 = 4 h (sexta) + 8 h (segunda)
    expect(horasUteisEntre(new Date(2026, 10, 13, 20), new Date(2026, 10, 16, 8))).toBe(12);
  });
  it("fim antes do início = 0", () => {
    expect(horasUteisEntre(new Date(2026, 10, 16, 8), new Date(2026, 10, 13, 8))).toBe(0);
  });
});

describe("deveEscalonar", () => {
  const base = { status: "ABERTO", responsavelId: null, escalonadoEm: null, criadoEm: new Date(2026, 10, 16, 8) };
  const depois = new Date(2026, 10, 17, 9); // 25 h úteis

  it("escalona depois do prazo", () => expect(deveEscalonar(base, 24, depois)).toBe(true));
  it("não escalona antes do prazo", () => expect(deveEscalonar(base, 48, depois)).toBe(false));
  it("não escalona sem prazo, com responsável, fora de ABERTO ou já escalonado", () => {
    expect(deveEscalonar(base, null, depois)).toBe(false);
    expect(deveEscalonar({ ...base, responsavelId: "u1" }, 24, depois)).toBe(false);
    expect(deveEscalonar({ ...base, status: "EM_ATENDIMENTO" }, 24, depois)).toBe(false);
    expect(deveEscalonar({ ...base, escalonadoEm: depois }, 24, depois)).toBe(false);
  });
});

describe("emailValido", () => {
  it.each(["coord@fatec.sp.gov.br", "a.b+c@x.io"])("aceita %s", (e) => expect(emailValido(e)).toBe(true));
  it.each(["sem-arroba", "a@b", "a@@b.com", "@b.com", "a@.com", "a@b.com.", "a b@c.com", "x@y.com, z@w.com", '"a"@b.com'])(
    "recusa %s",
    (e) => expect(emailValido(e)).toBe(false),
  );
});

describe("renderizar", () => {
  it("escapa os valores no corpo e não no assunto", () => {
    const vars = { "chamado.titulo": "<script>x</script>" };
    expect(renderizar("T: {{chamado.titulo}}", vars)).toBe("T: &lt;script&gt;x&lt;/script&gt;");
    expect(renderizar("T: {{ chamado.titulo }}", { "chamado.titulo": "a\nb" }, false)).toBe("T: a b");
  });
  it("chave desconhecida vira vazio", () => expect(renderizar("[{{nada}}]", {})).toBe("[]"));
});
