import {describe, it, expect} from "vitest";
import {buildLinks, isAdmin, isStaff, link, path} from "../../src/hateoas";

import type { Viewer } from "../../src/hateoas";


const viewer = (role: Viewer["role"]): Viewer => ({id: "u1", role});

describe("path", () => {
  it("interpola valores normais", () => {
    expect(path`/tickets/${"clx1"}/messages`).toBe("/tickets/clx1/messages");
  });

  it("codifica caracteres especiais", () => {
    expect(path`/tickets/${"a/b?c"}`).toBe("/tickets/a%2Fb%3Fc");
  });

  it("não deixa o ../ virar outro caminho", () => {
    expect(path`/tickets/${"../admin"}`).toBe("/tickets/..%2Fadmin");
  });

  it("aceita números", () => {
    expect(path`/page/${3}`).toBe("/page/3");
  });

  it("funciona sem interpolação", () => {
    expect(path`/tickets`).toBe("/tickets");
  });
});

describe("link", () => {
  it("usa GET por padrão", () => {
    expect(link("/tickets")).toEqual({ href: "/tickets", method: "GET" });
  });

  it("aceita método, title e name", () => {
    expect(link("/tickets/1", "PATCH", { name: "ENCERRADO" })).toEqual({
      href: "/tickets/1",
      method: "PATCH",
      name: "ENCERRADO",
    });
  });
});

describe("buildLinks", () => {
  it("mantém links válidos", () => {
    const l = buildLinks({ self: link("/a") });
    expect(l).toEqual({ self: { href: "/a", method: "GET" } });
  });

  it("descarta false, null, undefined e array vazio", () => {
    const l = buildLinks({
      self: link("/a"),
      reply: false,
      update: null,
      remove: undefined,
      transition: [],
    });
    expect(Object.keys(l)).toEqual(["self"]);
  });

  it("mantém array com itens", () => {
    const l = buildLinks({ transition: [link("/a", "PATCH", { name: "X" })] });
    expect(l.transition).toHaveLength(1);
  });

  it("condiciona o link ao estado (cenário real)", () => {
    const podeResponder = (status: string) => status !== "ENCERRADO";
    const abertos = buildLinks({ reply: podeResponder("ABERTO") && link("/m", "POST") });
    const encerrados = buildLinks({ reply: podeResponder("ENCERRADO") && link("/m", "POST") });
    expect(abertos).toHaveProperty("reply");
    expect(encerrados).not.toHaveProperty("reply");
  });
});

describe("papéis", () => {
  it("isStaff", () => {
    expect(isStaff(viewer("USUARIO"))).toBe(false);
    expect(isStaff(viewer("BACKOFFICE"))).toBe(true);
    expect(isStaff(viewer("TECNICO"))).toBe(true);
    expect(isStaff(viewer("ADMINISTRADOR"))).toBe(true);
  });

  it("isAdmin", () => {
    expect(isAdmin(viewer("ADMINISTRADOR"))).toBe(true);
    expect(isAdmin(viewer("TECNICO"))).toBe(false);
  });
});