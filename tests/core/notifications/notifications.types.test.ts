import { describe, expect, it } from "vitest";
import {
  TipoNotificacaoZ,
  CanalNotificacaoZ,
  NotificationsListQuerySchema,
  ParamsWithIdSchema,
  NotificationsListSchema,
  NotificationIdSchema,
} from "../../../src/core/notifications/notifications.types";

// ---------------------------------------------------------------------------
// notifications.types.ts é código DECLARATIVO: z.object(), .min(), .default()
// são chamadas de método que rodam uma vez ao importar o arquivo, sem
// if/else, sem branch. Por isso o relatório de cobertura já mostra 100%
// para este arquivo mesmo sem nenhum teste — mas isso só prova que o
// arquivo foi importado, não que a VALIDAÇÃO funciona. O comportamento real
// só aparece chamando .parse()/.safeParse() com dados de verdade, e é isso
// que este arquivo testa.
//
// Diferente dos outros 3 arquivos do módulo notifications (controller,
// routes, service), este não precisa de vi.mock nem de nenhum shim de
// Fastify/Prisma — os schemas Zod são completamente autocontidos.
//
// Toda expectativa abaixo foi confirmada empiricamente contra o Zod real
// antes de ser escrita (não é suposição sobre como o Zod "deveria" se
// comportar).
//
// ⚠️ Ajuste o caminho de import acima se a estrutura do projeto for
// diferente. Assumi este arquivo em:
//   tests/core/notifications/notifications.types.test.ts
// ---------------------------------------------------------------------------

describe("TipoNotificacaoZ", () => {
  const valoresValidos = [
    "CHAMADO_CRIADO",
    "CHAMADO_ATRIBUIDO",
    "CHAMADO_ATUALIZADO",
    "STATUS_ALTERADO",
    "MENSAGEM_NOVA",
    "ANEXO_NOVO",
    "SISTEMA",
  ] as const;

  // Testar cada um dos 7 valores individualmente (em vez de só 1 exemplo)
  // protege contra um typo silencioso no enum (ex.: "CHAMADO_CRIAD0" com
  // zero em vez de O) — um typo assim não quebraria a compilação, só faria
  // esse valor específico ser silenciosamente rejeitado em produção.
  it.each(valoresValidos)('aceita "%s" como tipo válido', (valor) => {
    expect(TipoNotificacaoZ.safeParse(valor).success).toBe(true);
  });

  it("rejeita um valor que não está na lista", () => {
    expect(TipoNotificacaoZ.safeParse("TIPO_INEXISTENTE").success).toBe(false);
  });

  it("é case-sensitive — rejeita a versão em minúsculas de um valor válido", () => {
    expect(TipoNotificacaoZ.safeParse("sistema").success).toBe(false);
  });

  it("rejeita valores que não são string (número, null, undefined)", () => {
    expect(TipoNotificacaoZ.safeParse(123).success).toBe(false);
    expect(TipoNotificacaoZ.safeParse(null).success).toBe(false);
    expect(TipoNotificacaoZ.safeParse(undefined).success).toBe(false);
  });
});

describe("CanalNotificacaoZ", () => {
  const valoresValidos = ["IN_APP", "EMAIL", "PUSH"] as const;

  it.each(valoresValidos)('aceita "%s" como canal válido', (valor) => {
    expect(CanalNotificacaoZ.safeParse(valor).success).toBe(true);
  });

  it("rejeita um valor que não está na lista (ex.: SMS)", () => {
    expect(CanalNotificacaoZ.safeParse("SMS").success).toBe(false);
  });

  it("é case-sensitive — rejeita a versão em minúsculas de um valor válido", () => {
    expect(CanalNotificacaoZ.safeParse("email").success).toBe(false);
  });
});

describe("NotificationsListQuerySchema", () => {
  describe("valores padrão quando nenhum campo é informado", () => {
    it("objeto vazio {} produz exatamente os 5 defaults documentados, mais nada", () => {
      const resultado = NotificationsListQuerySchema.parse({});

      // toStrictEqual (não toEqual): confirma que NENHUM campo opcional
      // (tipo/canal/criadoDe/criadoAte/search) aparece no resultado além
      // dos 5 campos com default — nem mesmo como `undefined` explícito.
      expect(resultado).toStrictEqual({
        page: 1,
        pageSize: 50,
        apenasNaoLidas: false,
        orderBy: "criadoEm",
        orderDir: "desc",
      });
    });
  });

  describe("page e pageSize — validação de inteiro positivo compartilhada", () => {
    it("page: sem informar, aplica default 1", () => {
      expect(NotificationsListQuerySchema.parse({}).page).toBe(1);
    });

    it("pageSize: sem informar, aplica default 50", () => {
      expect(NotificationsListQuerySchema.parse({}).pageSize).toBe(50);
    });

    it("page: coage string de query param (\"3\") para o número 3", () => {
      expect(NotificationsListQuerySchema.parse({ page: "3" }).page).toBe(3);
    });

    it("pageSize: coage string de query param (\"25\") para o número 25", () => {
      expect(NotificationsListQuerySchema.parse({ pageSize: "25" }).pageSize).toBe(25);
    });

    // page e pageSize compartilham a MESMA base de validação
    // (z.coerce.number().int().min(1)) — uma tabela × os dois campos evita
    // repetir os mesmos 5 casos de rejeição duas vezes.
    const valoresInvalidosDeInteiroPositivo = [
      { descricao: "zero", valor: 0 },
      { descricao: "negativo (-1)", valor: -1 },
      { descricao: "decimal (3.5)", valor: 3.5 },
      { descricao: 'string não numérica ("abc")', valor: "abc" },
      { descricao: "null", valor: null },
    ];

    it.each(["page", "pageSize"] as const)("%s rejeita valores que não são inteiro >= 1", (campo) => {
      for (const { valor } of valoresInvalidosDeInteiroPositivo) {
        const resultado = NotificationsListQuerySchema.safeParse({ [campo]: valor });
        expect(resultado.success, `${campo}=${JSON.stringify(valor)} deveria ser rejeitado`).toBe(false);
      }
    });

    it("pageSize: aceita o limite superior exato (1000)", () => {
      expect(NotificationsListQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(true);
    });

    it("pageSize: rejeita um valor acima do limite superior (1001)", () => {
      expect(NotificationsListQuerySchema.safeParse({ pageSize: 1001 }).success).toBe(false);
    });

    // Observação documentada via teste: ao contrário de pageSize, page NÃO
    // tem limite superior no schema (só .min(1), sem .max()). Isso não é
    // necessariamente um bug — só um fato verificado que vale a pena
    // vocês conhecerem. Este teste documenta o comportamento ATUAL; se um
    // dia for adicionado um .max() em page, é este teste que vai avisar.
    it("page: NÃO tem limite superior no schema (aceita valores muito grandes, ex.: 1e10)", () => {
      expect(NotificationsListQuerySchema.safeParse({ page: 1e10 }).success).toBe(true);
    });
  });

  describe("apenasNaoLidas — coerção booleana (z.coerce.boolean)", () => {
    const casosDeCoercao: Array<{ descricao: string; input: unknown; esperado: boolean }> = [
      { descricao: "omitido → aplica default false", input: undefined, esperado: false },
      { descricao: "true (boolean) → true", input: true, esperado: true },
      { descricao: "false (boolean) → false", input: false, esperado: false },
      { descricao: '"true" (string) → true', input: "true", esperado: true },
      {
        descricao:
          '"false" (string) → TRUE — pegadinha real da coerção do JS: Boolean("false") é true, porque QUALQUER string não-vazia é truthy, mesmo a palavra "false". Se o front mandar ?apenasNaoLidas=false esperando desligar o filtro, o filtro liga.',
        input: "false",
        esperado: true,
      },
      { descricao: '"" (string vazia) → false', input: "", esperado: false },
      { descricao: "0 (number) → false", input: 0, esperado: false },
      { descricao: "1 (number) → true", input: 1, esperado: true },
    ];

    it.each(casosDeCoercao)("$descricao", ({ input, esperado }) => {
      const query = input === undefined ? {} : { apenasNaoLidas: input };
      const resultado = NotificationsListQuerySchema.parse(query);
      expect(resultado.apenasNaoLidas).toBe(esperado);
    });
  });

  describe("tipo e canal — enums opcionais dentro do schema composto", () => {
    it("tipo: omitido, o campo fica ausente no resultado (não gera erro)", () => {
      const resultado = NotificationsListQuerySchema.parse({});
      expect(resultado.tipo).toBeUndefined();
    });

    it("tipo: valor válido (SISTEMA) é aceito e preservado", () => {
      expect(NotificationsListQuerySchema.parse({ tipo: "SISTEMA" }).tipo).toBe("SISTEMA");
    });

    it("tipo: valor inválido é rejeitado mesmo dentro do schema composto (não só isolado)", () => {
      expect(NotificationsListQuerySchema.safeParse({ tipo: "TIPO_INEXISTENTE" }).success).toBe(false);
    });

    it("canal: omitido, o campo fica ausente no resultado (não gera erro)", () => {
      const resultado = NotificationsListQuerySchema.parse({});
      expect(resultado.canal).toBeUndefined();
    });

    it("canal: valor válido (EMAIL) é aceito e preservado", () => {
      expect(NotificationsListQuerySchema.parse({ canal: "EMAIL" }).canal).toBe("EMAIL");
    });

    it("canal: valor inválido é rejeitado mesmo dentro do schema composto (não só isolado)", () => {
      expect(NotificationsListQuerySchema.safeParse({ canal: "SMS" }).success).toBe(false);
    });
  });

  describe("criadoDe, criadoAte e search — strings livres, SEM validação de formato", () => {
    // Importante: o schema aqui só garante que é uma STRING — não valida se
    // é uma data de verdade. Quem faz essa validação é a função parseISO
    // dentro de notifications.service.ts (já testada em outro arquivo:
    // string inválida vira `undefined` silenciosamente, sem quebrar a
    // busca). Este teste documenta explicitamente essa divisão de
    // responsabilidade entre schema e service.
    it("criadoDe: uma string com formato de data claramente inválido ainda passa neste schema", () => {
      expect(NotificationsListQuerySchema.safeParse({ criadoDe: "isso-nao-e-uma-data" }).success).toBe(
        true,
      );
    });

    it("criadoAte: mesma regra — formato inválido ainda passa neste schema", () => {
      expect(NotificationsListQuerySchema.safeParse({ criadoAte: "isso-nao-e-uma-data" }).success).toBe(
        true,
      );
    });

    it("criadoDe: rejeita quando o tipo não é string (ex.: número)", () => {
      expect(NotificationsListQuerySchema.safeParse({ criadoDe: 123 }).success).toBe(false);
    });

    it("search: string vazia é aceita pelo schema (sem .min() aqui)", () => {
      expect(NotificationsListQuerySchema.safeParse({ search: "" }).success).toBe(true);
    });

    it("search: omitido, o campo fica ausente no resultado", () => {
      expect(NotificationsListQuerySchema.parse({}).search).toBeUndefined();
    });
  });

  describe("orderBy e orderDir", () => {
    it("orderBy: sem informar, aplica default \"criadoEm\"", () => {
      expect(NotificationsListQuerySchema.parse({}).orderBy).toBe("criadoEm");
    });

    it('orderBy: aceita o único valor válido ("criadoEm")', () => {
      expect(NotificationsListQuerySchema.safeParse({ orderBy: "criadoEm" }).success).toBe(true);
    });

    it("orderBy: rejeita qualquer outro valor — é uma union de um único elemento, não uma string livre", () => {
      expect(NotificationsListQuerySchema.safeParse({ orderBy: "titulo" }).success).toBe(false);
    });

    it('orderDir: sem informar, aplica default "desc"', () => {
      expect(NotificationsListQuerySchema.parse({}).orderDir).toBe("desc");
    });

    it.each(["asc", "desc"] as const)('orderDir: aceita "%s" como valor válido', (valor) => {
      expect(NotificationsListQuerySchema.safeParse({ orderDir: valor }).success).toBe(true);
    });

    it('orderDir: rejeita um valor fora de "asc"/"desc" (ex.: "ascending")', () => {
      expect(NotificationsListQuerySchema.safeParse({ orderDir: "ascending" }).success).toBe(false);
    });
  });

  describe("comportamento com chaves desconhecidas", () => {
    // z.object() no modo padrão do Zod (sem .strict()) DESCARTA chaves
    // desconhecidas silenciosamente, em vez de rejeitar a entrada inteira.
    // Isso é o comportamento real confirmado, e vale a pena estar
    // documentado explicitamente — não é o padrão de toda biblioteca de
    // validação, e é fácil assumir o oposto por engano.
    it("uma chave extra não reconhecida é descartada silenciosamente, sem rejeitar a query inteira", () => {
      const resultado = NotificationsListQuerySchema.parse({
        page: 2,
        campoQueNaoExisteNoSchema: "qualquer coisa",
      });

      expect(resultado.page).toBe(2);
      expect(resultado).not.toHaveProperty("campoQueNaoExisteNoSchema");
    });
  });

  describe("integração — objeto totalmente populado e válido", () => {
    it("aceita e preserva todos os campos de uma vez quando todos são válidos", () => {
      const entrada = {
        page: 3,
        pageSize: 20,
        apenasNaoLidas: true,
        tipo: "MENSAGEM_NOVA" as const,
        canal: "PUSH" as const,
        criadoDe: "2024-01-01T00:00:00.000Z",
        criadoAte: "2024-12-31T23:59:59.000Z",
        search: "erro de pagamento",
        orderBy: "criadoEm" as const,
        orderDir: "asc" as const,
      };

      const resultado = NotificationsListQuerySchema.parse(entrada);

      expect(resultado).toStrictEqual(entrada);
    });
  });
});

describe("ParamsWithIdSchema", () => {
  it("aceita um id não vazio", () => {
    expect(ParamsWithIdSchema.safeParse({ id: "notif-abc-123" }).success).toBe(true);
  });

  it("rejeita id vazio (string vazia)", () => {
    expect(ParamsWithIdSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("rejeita quando a chave id está totalmente ausente", () => {
    expect(ParamsWithIdSchema.safeParse({}).success).toBe(false);
  });

  it("rejeita quando id não é string (ex.: número)", () => {
    expect(ParamsWithIdSchema.safeParse({ id: 123 }).success).toBe(false);
  });
});

describe("NotificationsListSchema e NotificationIdSchema — wrappers usados por buildRouteValidator", () => {
  describe("NotificationsListSchema", () => {
    it('envolve corretamente a query dentro de { query: {...} } — {query: {}} é válido (defaults se aplicam)', () => {
      expect(NotificationsListSchema.safeParse({ query: {} }).success).toBe(true);
    });

    it("rejeita quando a chave query está totalmente ausente", () => {
      expect(NotificationsListSchema.safeParse({}).success).toBe(false);
    });

    it("propaga a validação da query aninhada — page=0 dentro de query ainda é rejeitado através do wrapper", () => {
      expect(NotificationsListSchema.safeParse({ query: { page: 0 } }).success).toBe(false);
    });
  });

  describe("NotificationIdSchema", () => {
    it('envolve corretamente os params dentro de { params: {...} } — {params: {id: "x"}} é válido', () => {
      expect(NotificationIdSchema.safeParse({ params: { id: "notif-abc" } }).success).toBe(true);
    });

    it("rejeita quando a chave params está totalmente ausente", () => {
      expect(NotificationIdSchema.safeParse({}).success).toBe(false);
    });

    it("propaga a validação dos params aninhados — id vazio dentro de params ainda é rejeitado através do wrapper", () => {
      expect(NotificationIdSchema.safeParse({ params: { id: "" } }).success).toBe(false);
    });
  });
});