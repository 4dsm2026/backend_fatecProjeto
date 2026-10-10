import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import {
  ApiError,
  fieldErrorsFromZod,
  normalizeError,
  registerProblemHandler,
  toProblem,
} from "../../src/hateoas";
import type { ErrorKind } from "../../src/hateoas";

describe("ApiError", () => {
  it.each<[ErrorKind, number]>([
    ["bad-request", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not-found", 404],
    ["conflict", 409],
    ["unprocessable", 422],
    ["too-many-requests", 429],
    ["internal", 500],
  ])("%s vira status %i", (kind, status) => {
    expect(new ApiError(kind, "titulo").status).toBe(status);
  });

  it("guarda título, detalhe e erros por campo", () => {
    const e = new ApiError("bad-request", "Dados inválidos", "detalhe", [{ field: "a", message: "b" }]);
    expect(e.message).toBe("Dados inválidos");
    expect(e.detail).toBe("detalhe");
    expect(e.errors).toEqual([{ field: "a", message: "b" }]);
    expect(e).toBeInstanceOf(Error);
  });
});

describe("fieldErrorsFromZod", () => {
  it("une o path com ponto", () => {
    expect(
      fieldErrorsFromZod([
        { path: ["body", "email"], message: "inválido" },
        { path: ["itens", 0, "nome"], message: "obrigatório" },
      ]),
    ).toEqual([
      { field: "body.email", message: "inválido" },
      { field: "itens.0.nome", message: "obrigatório" },
    ]);
  });
});

describe("normalizeError", () => {
  it("ApiError passa direto", () => {
    const e = new ApiError("forbidden", "Sem permissão");
    expect(normalizeError(e)).toBe(e);
  });

  it("P2025 vira 404", () => {
    const e = normalizeError({ code: "P2025", message: "No record found secreto" });
    expect(e.kind).toBe("not-found");
    expect(e.message).not.toContain("secreto");
  });

  it("P2002 vira 409", () => {
    expect(normalizeError({ code: "P2002" }).kind).toBe("conflict");
  });

  it("erro de validação vira 400 com errors", () => {
    const e = normalizeError({
      validation: [{ instancePath: "/email", message: "must be string" }],
      validationContext: "body",
    });
    expect(e.kind).toBe("bad-request");
    expect(e.errors).toEqual([{ field: "body.email", message: "must be string" }]);
  });

  it("aceita instancePath que já começa com o contexto", () => {
    const e = normalizeError({
      validation: [{ instancePath: "/body/email", message: "x" }],
      validationContext: "body",
    });
    expect(e.errors?.[0].field).toBe("body.email");
  });

  it("required usa o missingProperty como campo", () => {
    const e = normalizeError({
      validation: [{ instancePath: "", params: { missingProperty: "email" }, message: "obrigatório" }],
      validationContext: "body",
    });
    expect(e.errors?.[0].field).toBe("body.email");
  });

  it.each<[number, ErrorKind]>([
    [400, "bad-request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [422, "unprocessable"],
    [429, "too-many-requests"],
  ])("statusCode %i vira %s", (statusCode, kind) => {
    expect(normalizeError({ statusCode, message: "x" }).kind).toBe(kind);
  });

  it("statusCode sem mapeamento (413) cai em 500", () => {
    expect(normalizeError({ statusCode: 413, message: "too large" }).status).toBe(500);
  });

  it("erro desconhecido vira 500 sem vazar a mensagem", () => {
    const e = normalizeError(new Error("senha do banco: abc123"));
    expect(e.status).toBe(500);
    expect(e.message).not.toContain("abc123");
    expect(e.detail).toBeUndefined();
  });

  it.each([["texto"], [null], [undefined], [42]])("valor %j que não é objeto vira 500", (valor) => {
    expect(normalizeError(valor).status).toBe(500);
  });
});

describe("toProblem", () => {
  it("segue o formato das convenções", () => {
    const e = new ApiError("not-found", "Ticket not found", "No ticket exists with id clx123");
    expect(toProblem(e, "/tickets/clx123")).toEqual({
      type: "/errors/not-found",
      title: "Ticket not found",
      status: 404,
      detail: "No ticket exists with id clx123",
      instance: "/tickets/clx123",
    });
  });

  it("omite detail e errors quando não existem", () => {
    const p = toProblem(new ApiError("internal", "Erro"), "/x");
    expect(p).not.toHaveProperty("detail");
    expect(p).not.toHaveProperty("errors");
  });

  it("inclui errors quando existem", () => {
    const p = toProblem(new ApiError("bad-request", "Dados inválidos", undefined, [{ field: "a", message: "b" }]), "/x");
    expect(p.errors).toEqual([{ field: "a", message: "b" }]);
  });
});

describe("registerProblemHandler (com Fastify de verdade)", () => {
  function criarApp() {
    const app = Fastify();
    registerProblemHandler(app);
    app.get("/api-error", async () => {
      throw new ApiError("not-found", "Chamado não encontrado", "Não existe chamado com esse id");
    });
    app.get("/boom", async () => {
      throw new Error("senha do banco: abc123");
    });
    app.get("/p2002", async () => {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    });
    app.get("/limite", async () => {
      throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    });
    app.post(
      "/validar",
      {
        schema: {
          body: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
        },
      },
      async () => ({ ok: true }),
    );
    return app;
  }

  it("ApiError: status, content-type e corpo no formato RFC 7807", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/api-error?x=1" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toEqual({
      type: "/errors/not-found",
      title: "Chamado não encontrado",
      status: 404,
      detail: "Não existe chamado com esse id",
      instance: "/api-error",
    });
  });

  it("5xx não vaza a mensagem original", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("abc123");
    expect(res.json().title).toBe("Erro interno do servidor");
  });

  it("P2002 vira 409", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/p2002" });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe("/errors/conflict");
  });

  it("429 vira too-many-requests", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/limite" });
    expect(res.statusCode).toBe(429);
    expect(res.json().type).toBe("/errors/too-many-requests");
  });

  it("validação do Fastify vira 400 com errors", async () => {
    const res = await criarApp().inject({ method: "POST", url: "/validar", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([{ field: "body.email", message: "must have required property 'email'" }]);
  });

  it("rota inexistente vira 404 problem+json", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/nao-existe?a=1" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().instance).toBe("/nao-existe");
  });
});