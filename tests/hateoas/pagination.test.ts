import { describe, it, expect } from "vitest";
import {
  PaginationQuerySchema,
  buildLinks,
  link,
  pageInfo,
  paginationLinks,
  toCollection,
  toSkipTake,
  withQuery,
} from "../../src/hateoas";
import type { Resource } from "../../src/hateoas";

describe("PaginationQuerySchema", () => {
  it("usa page 0 e size 20 por padrão", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 0, size: 20 });
  });

  it("converte texto da URL em número", () => {
    expect(PaginationQuerySchema.parse({ page: "2", size: "50" })).toEqual({ page: 2, size: 50 });
  });

  it.each([
    [{ page: "-1" }],
    [{ page: "1.5" }],
    [{ size: "0" }],
    [{ size: "101" }],
    [{ size: "abc" }],
  ])("rejeita %j", (query) => {
    expect(PaginationQuerySchema.safeParse(query).success).toBe(false);
  });

  it("aceita os limites (size 1 e 100)", () => {
    expect(PaginationQuerySchema.safeParse({ size: "1" }).success).toBe(true);
    expect(PaginationQuerySchema.safeParse({ size: "100" }).success).toBe(true);
  });
});


describe("toSkipTake", () => {
  it("calcula skip e take", () => {
    expect(toSkipTake({ page: 0, size: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, size: 10 })).toEqual({ skip: 30, take: 10 });
  });
});

describe("withQuery", () => {
  it("ordena as chaves e ignora undefined e vazio", () => {
    expect(withQuery("/tickets", { size: 20, q: "", status: undefined, page: 0 })).toBe(
      "/tickets?page=0&size=20",
    );
  });

  it("codifica os valores", () => {
    expect(withQuery("/tickets", { q: "a b&c" })).toBe("/tickets?q=a%20b%26c");
  });

  it("sem parâmetros devolve só o caminho", () => {
    expect(withQuery("/tickets", {})).toBe("/tickets");
  });

  it("mantém false e 0", () => {
    expect(withQuery("/x", { ativo: false, n: 0 })).toBe("/x?ativo=false&n=0");
  });
});

describe("pageInfo", () => {
  it("calcula totalPages arredondando para cima", () => {
    expect(pageInfo(0, 20, 134)).toEqual({ size: 20, number: 0, totalElements: 134, totalPages: 7 });
  });

  it("coleção vazia tem 0 páginas", () => {
    expect(pageInfo(0, 20, 0).totalPages).toBe(0);
  });
});

describe("paginationLinks", () => {
  const hrefs = (l: ReturnType<typeof paginationLinks>) =>
    Object.fromEntries(Object.entries(l).map(([rel, v]) => [rel, (v as { href: string }).href]));

  it("primeira página: sem prev, com next", () => {
    expect(hrefs(paginationLinks("/tickets", 0, 20, 100))).toEqual({
      self: "/tickets?page=0&size=20",
      first: "/tickets?page=0&size=20",
      last: "/tickets?page=4&size=20",
      next: "/tickets?page=1&size=20",
    });
  });

  it("página do meio: com prev e next", () => {
    const l = hrefs(paginationLinks("/tickets", 2, 20, 100));
    expect(l.prev).toBe("/tickets?page=1&size=20");
    expect(l.next).toBe("/tickets?page=3&size=20");
  });

  it("última página: sem next", () => {
    const l = paginationLinks("/tickets", 4, 20, 100);
    expect(l).not.toHaveProperty("next");
    expect(l).toHaveProperty("prev");
  });

  it("coleção vazia: só self, first e last na página 0", () => {
    const l = hrefs(paginationLinks("/tickets", 0, 20, 0));
    expect(Object.keys(l)).toEqual(["self", "first", "last"]);
    expect(l.last).toBe("/tickets?page=0&size=20");
  });

  it("página além do fim: prev aponta para a última existente", () => {
    const l = hrefs(paginationLinks("/tickets", 10, 20, 100));
    expect(l.prev).toBe("/tickets?page=4&size=20");
    expect(l).not.toHaveProperty("next");
  });

  it("preserva os filtros", () => {
    const l = hrefs(paginationLinks("/tickets", 0, 20, 100, { status: "ABERTO", q: "" }));
    expect(l.next).toBe("/tickets?page=1&size=20&status=ABERTO");
  });
});

describe("toCollection", () => {
  const items: Resource<{ id: string }>[] = [
    { id: "a", _links: { self: link("/tickets/a") } },
    { id: "b", _links: { self: link("/tickets/b") } },
  ];

  it("monta _embedded, page e _links", () => {
    const c = toCollection({ rel: "tickets", basePath: "/tickets", items, page: 0, size: 2, total: 5 });
    expect(c._embedded.tickets).toHaveLength(2);
    expect(c.page).toEqual({ size: 2, number: 0, totalElements: 5, totalPages: 3 });
    expect(c._links).toHaveProperty("next");
    expect(c._links).not.toHaveProperty("prev");
  });

  it("mescla links extras (ex.: create)", () => {
    const c = toCollection({
      rel: "tickets",
      basePath: "/tickets",
      items,
      page: 0,
      size: 2,
      total: 2,
      links: buildLinks({ create: link("/tickets", "POST") }),
    });
    expect(c._links).toHaveProperty("create");
    expect(c._links).toHaveProperty("self");
  });
});