import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Link, Role } from "../../../src/hateoas/types";
import { registerProblemHandler } from "../../../src/hateoas";
import { prismaMock } from "../../../src/lib/__mocks__/prisma";
import authVerify from "../../../src/plugins/auth-verify";
import prismaPlugin from "../../../src/plugins/prisma";
import { bearerAuth, makeAdminToken, makeUserToken } from "../../helpers/auth";
import { comunicacoesRoutes } from "../../../src/core/comunicacoes/comunicacoes.routes";
import { renderComAmostra } from "../../../src/core/comunicacoes/comunicacoes.service";

vi.mock("../../../src/lib/prisma");

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/config/mail", () => ({
  getMailDriver: () => ({ send: sendMock }),
}));

type TemplateItem = {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  habilitado: boolean;
  assunto: string;
  corpo: string;
  variaveis: string[] | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

const fixedDate = new Date("2026-01-01T00:00:00.000Z");

function makeTemplate(changes: Partial<TemplateItem> = {}): TemplateItem {
  return {
    id: "template-1",
    chave: "boas-vindas",
    nome: "Boas-vindas",
    descricao: null,
    habilitado: true,
    assunto: "Olá {{aluno.nome}}",
    corpo: "Bem-vindo",
    variaveis: ["aluno.nome"],
    criadoEm: fixedDate,
    atualizadoEm: fixedDate,
    ...changes,
  };
}

function tokenFor(role: Role): string {
  if (role === "ADMINISTRADOR") return makeAdminToken({ sub: "admin-1" });
  return makeUserToken({ sub: `${role.toLowerCase()}-1`, role });
}

async function callLink(app: FastifyInstance, item: Link, token: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: item.method ?? "GET",
    url: item.href,
    headers: bearerAuth(token),
    ...(payload ? { payload } : {}),
  });
}

const contractPayloads: Record<string, Record<string, unknown>> = {
  update: { nome: "Atualizado", assunto: "Assunto", corpo: "Corpo" },
  "communication-tests": { to: "teste@example.com", assunto: "Assunto", corpo: "Corpo" },
};

async function expectLinksUsable(
  app: FastifyInstance,
  links: Record<string, Link | Link[]>,
  token: string,
): Promise<void> {
  for (const [rel, entry] of Object.entries(links)) {
    const actions = Array.isArray(entry) ? entry : [entry];
    for (const action of actions) {
      const response = await callLink(app, action, token, contractPayloads[rel]);
      expect(response.statusCode).not.toBe(403);
      expect(response.statusCode).not.toBe(405);
    }
  }
}

Object.assign(prismaMock.comunicacaoTemplate, { count: vi.fn(), findUnique: vi.fn() });

function resetPrismaMocks(): void {
  vi.resetAllMocks();
  prismaMock.$connect.mockResolvedValue(undefined);
  prismaMock.$disconnect.mockResolvedValue(undefined);
  prismaMock.$queryRaw.mockResolvedValue([{ 1: 1 }]);
  prismaMock.comunicacaoTemplate.findMany.mockResolvedValue([makeTemplate()]);
  prismaMock.comunicacaoTemplate.count.mockResolvedValue(45);
  prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(makeTemplate());
  prismaMock.comunicacaoTemplate.upsert.mockResolvedValue(makeTemplate());
  sendMock.mockResolvedValue(undefined);
}

const nonAdminRoles = ["USUARIO", "BACKOFFICE", "TECNICO"] as const;
const protectedRequests = [
  { method: "GET", url: "/admin/communication-templates" },
  { method: "GET", url: "/admin/communication-templates/boas-vindas" },
  {
    method: "PUT",
    url: "/admin/communication-templates/boas-vindas",
    payload: { nome: "Boas-vindas", assunto: "Assunto", corpo: "Corpo" },
  },
  {
    method: "POST",
    url: "/admin/communication-tests",
    payload: { to: "teste@example.com", assunto: "Assunto", corpo: "Corpo" },
  },
] as const;

const forbiddenRequests = nonAdminRoles.flatMap((role) =>
  protectedRequests.map((request) => ({ role, ...request })),
);

let app: FastifyInstance;

beforeAll(async () => {
  resetPrismaMocks();
  app = Fastify({ logger: false });
  await app.register(prismaPlugin);
  await app.register(authVerify);
  registerProblemHandler(app);
  await app.register(comunicacoesRoutes, { prefix: "/admin" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resetPrismaMocks();
});

describe("communication templates HAL routes", () => {
  it("replaces unknown sample variables with the example fallback", () => {
    expect(renderComAmostra("Valor: {{variavel.desconhecida}}")).toBe("Valor: [exemplo]");
  });

  it("returns a paginated collection under the kebab-case embedded relation", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/communication-templates",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body._embedded["communication-templates"]).toHaveLength(1);
    expect(body.page).toEqual({ size: 20, number: 0, totalElements: 45, totalPages: 3 });
    expect(body._embedded["communication-templates"][0]).toMatchObject({
      id: "template-1",
      chave: "boas-vindas",
      nome: "Boas-vindas",
      _links: {
        self: { href: "/admin/communication-templates/boas-vindas", method: "GET" },
        collection: { href: "/admin/communication-templates", method: "GET" },
        update: { href: "/admin/communication-templates/boas-vindas", method: "PUT" },
      },
    });
    expect(body._embedded["communication-templates"][0]._links).not.toHaveProperty("delete");
    expect(body._links.create).toBeUndefined();
    expect(body._links["communication-tests"]).toEqual({
      href: "/admin/communication-tests",
      method: "POST",
    });
  });

  it("applies pagination defaults, maximum size and bounds", async () => {
    const headers = bearerAuth(tokenFor("ADMINISTRADOR"));
    const maximum = await app.inject({ method: "GET", url: "/admin/communication-templates?page=0&size=100", headers });
    const negativePage = await app.inject({ method: "GET", url: "/admin/communication-templates?page=-1", headers });
    const oversized = await app.inject({ method: "GET", url: "/admin/communication-templates?size=101", headers });

    expect(maximum.statusCode).toBe(200);
    expect(prismaMock.comunicacaoTemplate.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ skip: 0, take: 100 }),
    );
    expect(negativePage.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
  });

  it("includes prev, next and last links for a middle page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/communication-templates?page=2&size=10",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.json()._links.prev.href).toBe("/admin/communication-templates?page=1&size=10");
    expect(response.json()._links.next.href).toBe("/admin/communication-templates?page=3&size=10");
    expect(response.json()._links.last.href).toBe("/admin/communication-templates?page=4&size=10");
  });

  it("returns an RFC 7807 not-found problem for an unknown key", async () => {
    prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/admin/communication-templates/missing",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ type: "/errors/not-found", status: 404 });
  });

  it("accepts one- and 64-character keys and rejects keys over 64 characters", async () => {
    const token = bearerAuth(tokenFor("ADMINISTRADOR"));
    const oneCharacter = await app.inject({
      method: "GET",
      url: "/admin/communication-templates/a",
      headers: token,
    });
    const maximumKey = "k".repeat(64);
    const sixtyFourCharacters = await app.inject({
      method: "GET",
      url: `/admin/communication-templates/${maximumKey}`,
      headers: token,
    });
    const tooLong = await app.inject({
      method: "GET",
      url: `/admin/communication-templates/${maximumKey}k`,
      headers: token,
    });

    expect(oneCharacter.statusCode).toBe(200);
    expect(sixtyFourCharacters.statusCode).toBe(200);
    expect(tooLong.statusCode).toBe(400);
  });

  it("returns 201 and Location when PUT creates a new template", async () => {
    prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(null);
    prismaMock.comunicacaoTemplate.upsert.mockResolvedValue(makeTemplate());

    const response = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/boas-vindas",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { nome: "Boas-vindas", assunto: "Assunto", corpo: "Corpo" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe("/admin/communication-templates/boas-vindas");
    expect(response.json()._links.self.href).toBe("/admin/communication-templates/boas-vindas");
  });

  it("returns 200 without Location when PUT updates an existing template", async () => {
    prismaMock.comunicacaoTemplate.findUnique.mockResolvedValue(makeTemplate());
    prismaMock.comunicacaoTemplate.upsert.mockResolvedValue(makeTemplate({ nome: "Atualizado" }));

    const response = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/boas-vindas",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { nome: "Atualizado", assunto: "Assunto", corpo: "Corpo" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.location).toBeUndefined();
    expect(response.json()._links.update).toEqual({
      href: "/admin/communication-templates/boas-vindas",
      method: "PUT",
    });
  });

  it.each(forbiddenRequests)("returns 403 for $role on $method $url without side effects", async (request) => {
    const response = await app.inject({
      method: request.method,
      url: request.url,
      headers: bearerAuth(tokenFor(request.role)),
      ...( "payload" in request ? { payload: request.payload } : {}),
    });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.comunicacaoTemplate.upsert).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends a test email with a 200 result and does not persist a test resource", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { to: "teste@example.com", assunto: "Olá {{aluno.nome}}", corpo: "Bem-vindo" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      message: "E-mail de teste enviado para teste@example.com",
      _links: {
        "communication-tests": { href: "/admin/communication-tests", method: "POST" },
        collection: { href: "/admin/communication-templates", method: "GET" },
      },
    });
    expect(response.json()._links).not.toHaveProperty("self");
    expect(response.headers.location).toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.comunicacaoTemplate.upsert).not.toHaveBeenCalled();
  });

  it("returns a validation problem for an invalid test email body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { to: "not-an-email", assunto: "Assunto", corpo: "Corpo" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json().errors).toContainEqual(expect.objectContaining({ field: "to" }));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("enforces storage byte limits and restored character limits", async () => {
    const headers = bearerAuth(tokenFor("ADMINISTRADOR"));
    const maximumBytes = "é".repeat(32_767) + "a";
    const subjectAtLimit = "s".repeat(500);
    const accepted = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/limites",
      headers,
      payload: {
        nome: "n".repeat(160),
        descricao: "d".repeat(500),
        assunto: subjectAtLimit,
        corpo: maximumBytes,
      },
    });
    expect(Buffer.byteLength(maximumBytes, "utf8")).toBe(65_535);
    expect(accepted.statusCode).toBe(200);

    const tooLongDescription = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/limites",
      headers,
      payload: { nome: "Nome", descricao: "d".repeat(501), assunto: "Assunto", corpo: "Corpo" },
    });
    expect(tooLongDescription.statusCode).toBe(400);
    expect(tooLongDescription.headers["content-type"]).toContain("application/problem+json");
    expect(tooLongDescription.json().errors).toContainEqual(expect.objectContaining({ field: "descricao" }));

    const tooLongName = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/limites",
      headers,
      payload: { nome: "n".repeat(161), assunto: "Assunto", corpo: "Corpo" },
    });
    expect(tooLongName.statusCode).toBe(400);
    expect(tooLongName.json().errors).toContainEqual(expect.objectContaining({ field: "nome" }));

    const tooLongTemplateSubject = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/limites",
      headers,
      payload: { nome: "Nome", assunto: "s".repeat(501), corpo: "Corpo" },
    });
    expect(tooLongTemplateSubject.statusCode).toBe(400);
    expect(tooLongTemplateSubject.json().errors).toContainEqual(expect.objectContaining({ field: "assunto" }));

    const tooLongTemplateBody = await app.inject({
      method: "PUT",
      url: "/admin/communication-templates/limites",
      headers,
      payload: { nome: "Nome", assunto: "Assunto", corpo: "é".repeat(32_768) },
    });
    expect(tooLongTemplateBody.statusCode).toBe(400);
    expect(tooLongTemplateBody.json().errors).toContainEqual(
      expect.objectContaining({ field: "corpo", message: "Corpo deve ter no máximo 65.535 bytes em UTF-8." }),
    );

    const testBodyAtLimit = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers,
      payload: { to: "teste@example.com", assunto: subjectAtLimit, corpo: maximumBytes },
    });
    expect(testBodyAtLimit.statusCode).toBe(200);

    const testSubjectOverLimit = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers,
      payload: { to: "teste@example.com", assunto: "s".repeat(501), corpo: "Corpo" },
    });
    expect(testSubjectOverLimit.statusCode).toBe(400);
    expect(testSubjectOverLimit.json().errors).toContainEqual(expect.objectContaining({ field: "assunto" }));

    const testBodyOverLimit = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers,
      payload: { to: "teste@example.com", assunto: "Assunto", corpo: "é".repeat(32_768) },
    });
    expect(testBodyOverLimit.statusCode).toBe(400);
    expect(testBodyOverLimit.json().errors).toContainEqual(
      expect.objectContaining({ field: "corpo", message: "Corpo deve ter no máximo 65.535 bytes em UTF-8." }),
    );

  });

  it("returns a generic problem when the mail provider rejects the test", async () => {
    sendMock.mockRejectedValueOnce(new Error("private provider detail"));

    const response = await app.inject({
      method: "POST",
      url: "/admin/communication-tests",
      headers: bearerAuth(tokenFor("ADMINISTRADOR")),
      payload: { to: "teste@example.com", assunto: "Assunto", corpo: "Corpo" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(JSON.stringify(response.json())).not.toContain("private provider detail");
  });

  it("contracts every item link and confirms the collection has no create action", async () => {
    const token = tokenFor("ADMINISTRADOR");
    const itemResponse = await app.inject({
      method: "GET",
      url: "/admin/communication-templates/boas-vindas",
      headers: bearerAuth(token),
    });
    const itemLinks = itemResponse.json()._links as Record<string, Link | Link[]>;
    await expectLinksUsable(app, itemLinks, token);

    const collectionResponse = await app.inject({
      method: "GET",
      url: "/admin/communication-templates",
      headers: bearerAuth(token),
    });
    const collectionLinks = collectionResponse.json()._links as Record<string, Link | Link[]>;
    expect(collectionLinks).not.toHaveProperty("create");
    await expectLinksUsable(app, collectionLinks, token);
  });
});