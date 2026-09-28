import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { NotificationsListQuery } from "../../../src/core/notifications/notifications.types";

import {
  listNotifications,
  markAsRead,
  archiveNotification,
  unarchiveNotification,
  markAllAsRead,
  createTestNotification,
} from "../../../src/core/notifications/notifications.service";

// ---------------------------------------------------------------------------
// Diferente dos testes de controller/routes, este arquivo NÃO precisa de
// vi.mock: notifications.service.ts não importa nenhum módulo com efeito
// colateral em tempo de execução — @prisma/client e notifications.types são
// usados só como TYPE. O "prisma" é recebido por parâmetro (injeção de
// dependência), então basta passar um objeto fake diretamente.
//
// SOBRE O TIPO NotificationsListQuery (revisão importante desta versão):
// A primeira versão deste arquivo usava um tipo INFERIDO pelo uso dentro do
// service, com todos os campos opcionais. Isso causou erros de compilação
// reais quando comparado ao notifications.types.ts de verdade, porque o
// schema Zod usa `.default(...)` em page, pageSize, apenasNaoLidas, orderBy
// e orderDir — e no Zod, um campo com `.default()` deixa de ser opcional no
// tipo de SAÍDA (z.infer): o parser garante que o valor estará presente,
// então o TypeScript exige que ele esteja presente também. Além disso,
// `orderBy` é `z.enum(["criadoEm"])` — union de um único valor, não uma
// string livre.
//
// Na prática, isso significa que o ÚNICO shape type-válido de
// NotificationsListQuery já vem com page/pageSize/apenasNaoLidas/orderBy/
// orderDir sempre presentes (é exatamente o que o Zod entrega ao controller
// depois de fazer o parse — mesmo que o usuário não tenha mandado nenhum
// desses campos na querystring, o `.default()` já preenche antes de chegar
// aqui). Por isso, todo teste abaixo usa DEFAULT_QUERY como base e só
// sobrescreve o campo que está sendo testado, em vez de montar objetos
// parciais como {} ou { tipo: "X" } soltos.
//
// Uso de fake timers (vi.setSystemTime): markAsRead, archiveNotification e
// markAllAsRead chamam `new Date()` internamente. Fixamos o relógio do
// sistema para o mesmo instante em todo teste e comparamos contra esse
// valor exato — mais rigoroso que expect.any(Date), que só provaria que
// "alguma" data foi passada, não que é a data CERTA.
//
// ⚠️ Ajuste os caminhos de import acima se a estrutura do projeto for
// diferente. Assumi este arquivo em:
//   tests/core/notifications/notifications.service.test.ts
// ---------------------------------------------------------------------------

const USER_ID = "user-a1b2c3";
const NOTIFICATION_ID = "notif-x9y8z7";
const FIXED_NOW = new Date("2026-01-15T10:30:00.000Z");

// Exatamente o que o Zod entrega quando o usuário não manda nenhum parâmetro
// de query: todos os defaults já resolvidos. Este é o único shape 100%
// type-válido de "query vazia" — {} sozinho não satisfaz mais o tipo.
const DEFAULT_QUERY: NotificationsListQuery = {
  page: 1,
  pageSize: 50,
  apenasNaoLidas: false,
  orderBy: "criadoEm",
  orderDir: "desc",
};

const mockCount = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
const mockCreate = vi.fn();

const prisma = {
  notificacao: {
    count: mockCount,
    findMany: mockFindMany,
    updateMany: mockUpdateMany,
    create: mockCreate,
  },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// listNotifications
// ===========================================================================
describe("listNotifications", () => {
  describe("construção do filtro (where)", () => {
    it("query totalmente default (nada informado pelo usuário, Zod já resolveu os padrões) → where contém somente usuarioId", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, DEFAULT_QUERY);

      expect(mockCount).toHaveBeenCalledWith({ where: { usuarioId: USER_ID } });
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { usuarioId: USER_ID } }),
      );
    });

    type SingleFilterCase = {
      description: string;
      query: NotificationsListQuery;
      expectedExtra: Record<string, unknown>;
    };

    const singleFilterCases: SingleFilterCase[] = [
      {
        description: "apenasNaoLidas=true adiciona lidaEm e arquivadaEm nulos",
        query: { ...DEFAULT_QUERY, apenasNaoLidas: true },
        expectedExtra: { lidaEm: null, arquivadaEm: null },
      },
      {
        // Propositalmente NÃO uso "SISTEMA" aqui — esse é o valor fixo que
        // createTestNotification usa. Usar um valor diferente ("CHAMADO_
        // CRIADO") prova que o filtro repassa o valor recebido de verdade,
        // e não bateria "por coincidência" com um valor hardcoded errado.
        description: "tipo adiciona filtro exato de tipo",
        query: { ...DEFAULT_QUERY, tipo: "CHAMADO_CRIADO" },
        expectedExtra: { tipo: "CHAMADO_CRIADO" },
      },
      {
        description: "canal adiciona filtro exato de canal",
        query: { ...DEFAULT_QUERY, canal: "EMAIL" },
        expectedExtra: { canal: "EMAIL" },
      },
      {
        description: "search adiciona OR case-insensitive em titulo e mensagem",
        query: { ...DEFAULT_QUERY, search: "erro de pagamento" },
        expectedExtra: {
          OR: [
            { titulo: { contains: "erro de pagamento", mode: "insensitive" } },
            { mensagem: { contains: "erro de pagamento", mode: "insensitive" } },
          ],
        },
      },
    ];

    it.each(singleFilterCases)("$description", async ({ query, expectedExtra }) => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, query);

      expect(mockCount).toHaveBeenCalledWith({
        where: { usuarioId: USER_ID, ...expectedExtra },
      });
    });

    it("somente criadoDe informado → aplica gte, sem lte", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        criadoDe: "2024-01-01T00:00:00.000Z",
      });

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          usuarioId: USER_ID,
          criadoEm: { gte: new Date("2024-01-01T00:00:00.000Z") },
        },
      });
    });

    it("somente criadoAte informado → aplica lte, sem gte", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        criadoAte: "2024-12-31T23:59:59.000Z",
      });

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          usuarioId: USER_ID,
          criadoEm: { lte: new Date("2024-12-31T23:59:59.000Z") },
        },
      });
    });

    it("criadoDe e criadoAte juntos → aplica gte e lte no mesmo filtro criadoEm", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        criadoDe: "2024-01-01T00:00:00.000Z",
        criadoAte: "2024-12-31T23:59:59.000Z",
      });

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          usuarioId: USER_ID,
          criadoEm: {
            gte: new Date("2024-01-01T00:00:00.000Z"),
            lte: new Date("2024-12-31T23:59:59.000Z"),
          },
        },
      });
    });

    it("criadoDe com formato de data inválido é silenciosamente ignorado (não quebra a busca, não filtra por data)", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        criadoDe: "isso-nao-e-uma-data-valida",
      });

      // Sem criadoEm no where: a string inválida virou `undefined` dentro de
      // parseISO, e como criadoAte também não foi informado, o filtro de
      // data inteiro é descartado — não gera um "Invalid Date" na consulta.
      expect(mockCount).toHaveBeenCalledWith({ where: { usuarioId: USER_ID } });
    });

    it("todos os filtros combinados → where reúne todos os campos ao mesmo tempo, sem um pisar no outro", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        apenasNaoLidas: true,
        tipo: "SISTEMA",
        canal: "IN_APP",
        criadoDe: "2024-01-01T00:00:00.000Z",
        criadoAte: "2024-12-31T23:59:59.000Z",
        search: "erro",
      });

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          usuarioId: USER_ID,
          lidaEm: null,
          arquivadaEm: null,
          tipo: "SISTEMA",
          canal: "IN_APP",
          criadoEm: {
            gte: new Date("2024-01-01T00:00:00.000Z"),
            lte: new Date("2024-12-31T23:59:59.000Z"),
          },
          OR: [
            { titulo: { contains: "erro", mode: "insensitive" } },
            { mensagem: { contains: "erro", mode: "insensitive" } },
          ],
        },
      });
    });

    it("count e findMany recebem o MESMO objeto where (filtro consistente entre o total e a página)", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, { ...DEFAULT_QUERY, tipo: "CHAMADO_CRIADO" });

      const whereFromCount = mockCount.mock.calls[0][0].where;
      const whereFromFindMany = mockFindMany.mock.calls[0][0].where;
      expect(whereFromFindMany).toStrictEqual(whereFromCount);
    });
  });

  describe("ordenação", () => {
    // orderBy é z.enum(["criadoEm"]) no schema real — union de um valor só.
    // Não existe um segundo valor legítimo para testar "orderBy explícito
    // diferente do padrão", porque não há outro campo ordenável hoje. A
    // única variação real e válida é orderDir (asc/desc).
    it("orderDir padrão (desc, resolvido pelo Zod) → ordena por criadoEm desc", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, DEFAULT_QUERY);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { criadoEm: "desc" } }),
      );
    });

    it("orderDir=asc → ordena por criadoEm asc", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, { ...DEFAULT_QUERY, orderDir: "asc" });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { criadoEm: "asc" } }),
      );
    });
  });

  describe("paginação", () => {
    it("page=1, pageSize=50 (padrão resolvido pelo Zod) → skip=0", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      const result = await listNotifications(prisma, USER_ID, DEFAULT_QUERY);

      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }));
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("com page=3 e pageSize=10 → skip=20 (fórmula (page-1)*pageSize verificada com números não-triviais)", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      const result = await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        page: 3,
        pageSize: 10,
      });

      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
    });

    it("page=2 e pageSize=1 → skip=1 (caso pequeno adicional, garante que a fórmula não é só '* 10' por coincidência)", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, { ...DEFAULT_QUERY, page: 2, pageSize: 1 });

      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 1, take: 1 }));
    });
  });

  describe("shape da consulta e do retorno", () => {
    it("select traz exatamente os 15 campos esperados (nada a mais, nada a menos)", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      await listNotifications(prisma, USER_ID, DEFAULT_QUERY);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            usuarioId: true,
            titulo: true,
            mensagem: true,
            tipo: true,
            canal: true,
            criadoEm: true,
            lidaEm: true,
            arquivadaEm: true,
            erroEntrega: true,
            meta: true,
            organizacaoId: true,
            chamadoId: true,
            mensagemId: true,
            anexoId: true,
          },
        }),
      );
    });

    it("retorna total e items exatamente como o prisma devolveu, junto com page/pageSize resolvidos", async () => {
      const fakeItems = [
        { id: "n1", usuarioId: USER_ID, titulo: "Título 1" },
        { id: "n2", usuarioId: USER_ID, titulo: "Título 2" },
      ];
      mockCount.mockResolvedValueOnce(42);
      mockFindMany.mockResolvedValueOnce(fakeItems);

      const result = await listNotifications(prisma, USER_ID, {
        ...DEFAULT_QUERY,
        page: 2,
        pageSize: 5,
      });

      expect(result).toStrictEqual({
        total: 42,
        page: 2,
        pageSize: 5,
        items: fakeItems,
      });
    });
  });

  describe("fallback interno de page/pageSize/orderBy/orderDir (código defensivo do service)", () => {
    // Por que este teste existe e por que ele foge do padrão dos demais:
    //
    // NotificationsListQuery exige page/pageSize/orderBy/orderDir sempre
    // presentes (o Zod aplica .default() antes do controller repassar a
    // query ao service, e um campo com .default() deixa de ser opcional no
    // tipo de SAÍDA — z.infer). Isso significa que, pelo fluxo real da
    // aplicação, esses 4 campos NUNCA chegam `undefined` aqui.
    //
    // Só que o código do service ainda escreve `q.page ?? 1`,
    // `q.pageSize ?? 50`, `q.orderBy ?? "criadoEm"` e `q.orderDir ?? "desc"`
    // — um fallback defensivo que, com um q sempre completo, nunca executa
    // o lado direito do "??". Testado só com objetos type-válidos (como
    // todos os outros testes deste arquivo, de propósito), esse fallback
    // fica com 4 branches sem cobertura (linhas 34-45 no relatório do v8).
    //
    // Este teste verifica que esse código defensivo FUNCIONA de verdade,
    // caso um dia outro chamador (uma rotina interna, um script, um job)
    // invoque listNotifications sem passar pela validação Zod do
    // controller. O cast abaixo é INTENCIONAL — está simulando exatamente
    // esse cenário fora do fluxo normal, não é um objeto real que a
    // aplicação produz hoje.
    it("q sem page/pageSize/orderBy/orderDir → aplica os 4 valores padrão internos (1, 50, 'criadoEm', 'desc')", async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindMany.mockResolvedValueOnce([]);

      const incompleteQuery = { apenasNaoLidas: false } as NotificationsListQuery;

      const result = await listNotifications(prisma, USER_ID, incompleteQuery);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 50,
          orderBy: { criadoEm: "desc" },
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });
  });
});

// ===========================================================================
// markAsRead / archiveNotification / unarchiveNotification
// — comportamento de "não encontrado" compartilhado pelas três
// (nenhuma delas recebe NotificationsListQuery, então nada aqui foi afetado
// pela correção de tipos — mantido idêntico à versão anterior)
// ===========================================================================
const idScopedNotFoundCases = [
  { name: "markAsRead", fn: markAsRead },
  { name: "archiveNotification", fn: archiveNotification },
  { name: "unarchiveNotification", fn: unarchiveNotification },
];

describe.each(idScopedNotFoundCases)("$name — quando updateMany não atualiza nada (count=0)", ({ fn }) => {
  it("lança um Error real com code P2025 e mensagem 'Notificação não encontrada'", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    let caughtError: unknown;
    try {
      await fn(prisma, NOTIFICATION_ID, USER_ID);
    } catch (e) {
      caughtError = e;
    }

    // instanceof Error importa de verdade aqui: o controller (errMsg) decide
    // como formatar a mensagem de erro com base nesse teste.
    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError).toMatchObject({
      message: "Notificação não encontrada",
      code: "P2025",
    });
  });
});

// ===========================================================================
// markAsRead — caminho de sucesso
// ===========================================================================
describe("markAsRead", () => {
  it("sucesso: escopa updateMany por id E usuarioId (proteção IDOR), marca lidaEm com o instante atual, zera arquivadaEm e erroEntrega", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await markAsRead(prisma, NOTIFICATION_ID, USER_ID);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, usuarioId: USER_ID },
      data: {
        lidaEm: FIXED_NOW,
        arquivadaEm: null,
        erroEntrega: null,
      },
    });
  });
});

// ===========================================================================
// archiveNotification — caminho de sucesso
// ===========================================================================
describe("archiveNotification", () => {
  it("sucesso: escopa updateMany por id e usuarioId, marca arquivadaEm com o instante atual", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await archiveNotification(prisma, NOTIFICATION_ID, USER_ID);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, usuarioId: USER_ID },
      data: { arquivadaEm: FIXED_NOW },
    });
  });
});

// ===========================================================================
// unarchiveNotification — caminho de sucesso
// ===========================================================================
describe("unarchiveNotification", () => {
  it("sucesso: escopa updateMany por id e usuarioId, zera arquivadaEm", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await unarchiveNotification(prisma, NOTIFICATION_ID, USER_ID);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, usuarioId: USER_ID },
      data: { arquivadaEm: null },
    });
  });
});

// ===========================================================================
// markAllAsRead
// ===========================================================================
describe("markAllAsRead", () => {
  it("marca como lidas todas as notificações não lidas e não arquivadas do usuário, retorna a contagem", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 7 });

    const result = await markAllAsRead(prisma, USER_ID);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { usuarioId: USER_ID, lidaEm: null, arquivadaEm: null },
      data: { lidaEm: FIXED_NOW },
    });
    expect(result).toStrictEqual({ count: 7 });
  });

  it("retorna count=0 SEM lançar erro quando não há nada para marcar (diferente de markAsRead/archive/unarchive, de propósito)", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await markAllAsRead(prisma, USER_ID);

    expect(result).toStrictEqual({ count: 0 });
  });
});

// ===========================================================================
// createTestNotification
// ===========================================================================
describe("createTestNotification", () => {
  it("cria a notificação com o payload fixo esperado e devolve exatamente o que o prisma retornar (pass-through)", async () => {
    const createdRecord = { id: "generated-id-999" };
    mockCreate.mockResolvedValueOnce(createdRecord);

    const result = await createTestNotification(prisma, USER_ID);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        usuarioId: USER_ID,
        titulo: "Ping do sistema",
        mensagem: "Exemplo de notificação",
        tipo: "SISTEMA",
        canal: "IN_APP",
        meta: { url: "/dashboard" },
      },
      select: { id: true },
    });
    // toBe (não toEqual): o código faz `return prisma.notificacao.create(...)`
    // direto, sem transformar nada — a MESMA referência deve voltar.
    expect(result).toBe(createdRecord);
  });
});