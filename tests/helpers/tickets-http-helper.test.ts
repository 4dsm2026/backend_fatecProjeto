import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignTicket, changeStatus, createTicket } from "../integration/_helpers/tickets";

type RequestRecord = { method: string; url: string; authorization?: string; body: unknown };
const received: RequestRecord[] = [];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/tickets") {
      res.writeHead(201).end(JSON.stringify({ id: "ticket-1", protocolo: "TCK-1" }));
    } else if (req.url === "/tickets/invalido") {
      res.writeHead(409).end(JSON.stringify({ title: "Transição inválida" }));
    } else {
      res.writeHead(200).end(JSON.stringify({ id: "ticket-1" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("helper HTTP de chamados", () => {
  const session = { accessToken: "token-de-teste" };

  it("cria um chamado com autenticação e devolve os campos da resposta", async () => {
    const ticket = await createTicket({ baseUrl }, session, { titulo: "Teste de integração" });
    expect(ticket).toMatchObject({ id: "ticket-1", protocolo: "TCK-1" });
    expect(received.at(-1)).toMatchObject({
      method: "POST", url: "/tickets", authorization: "Bearer token-de-teste",
      body: { titulo: "Teste de integração", descricao: expect.any(String) },
    });
  });

  it("atribui e muda o status usando PATCH com o corpo correto", async () => {
    await assignTicket({ baseUrl }, session, "ticket-1", "user-1");
    expect(received.at(-1)).toMatchObject({ method: "PATCH", url: "/tickets/ticket-1", body: { responsavelId: "user-1" } });
    await changeStatus({ baseUrl }, session, "ticket-1", "EM_ATENDIMENTO");
    expect(received.at(-1)).toMatchObject({ method: "PATCH", url: "/tickets/ticket-1", body: { status: "EM_ATENDIMENTO" } });
  });

  it("informa o status e o corpo quando a API rejeita a operação", async () => {
    await expect(changeStatus({ baseUrl }, session, "invalido", "RESOLVIDO"))
      .rejects.toThrow(/esperado 200, recebido 409.*Transição inválida/);
  });
});
