import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { notifyMany } from "../../../src/core/notifications/notify";

// ---------------------------------------------------------------------------
// Assim como notifications.service.ts, este arquivo não precisa de vi.mock:
// notify.ts não importa nenhum módulo com efeito colateral em tempo de
// execução (@prisma/client é usado só como TYPE), e o "prisma" chega por
// parâmetro. Também não usa `new Date()` em lugar nenhum, então — diferente
// de notifications.service.ts — não precisa de fake timers aqui.
//
// O ponto mais importante deste arquivo não é cobertura de linha, é
// CORREÇÃO DE FILTRAGEM: notifyMany recebe uma lista de usuários candidatos
// (`usuarios`) mas só deve notificar quem tem `notificacoesInApp=true`
// (`alvos`, o resultado filtrado do findMany). Um bug aqui — usar
// `usuarios` em vez de `alvos` no createMany — faria o sistema notificar
// gente que explicitamente desligou notificações in-app. O teste
// "filtragem por opt-in" abaixo é desenhado especificamente para pegar essa
// classe de regressão: usa uma lista de candidatos MAIOR que a lista de
// quem realmente optou, e confere que o excluído nunca aparece no
// createMany.
//
// ⚠️ Ajuste o caminho de import acima se a estrutura do projeto for
// diferente. Assumi este arquivo em:
//   tests/core/notifications/notify.test.ts
// ---------------------------------------------------------------------------

// Shape de um registro criado em prisma.notificacao.createMany({ data: [...] }).
// Definido aqui (em vez de usar `any`) só para evitar `any` nas asserções
// abaixo — não precisa bater 100% com o tipo gerado pelo Prisma real, já
// que o mock não é tipado contra o schema.prisma de verdade.
interface NotificacaoCriada {
  usuarioId: string;
  titulo: string;
  mensagem: string;
  tipo: string;
  canal: string;
  chamadoId: string | null;
  mensagemId: string | null;
  organizacaoId: string | null;
  anexoId: string | null;
  meta: unknown;
}

const mockFindMany = vi.fn();
const mockCreateMany = vi.fn();

const prisma = {
  usuario: {
    findMany: mockFindMany,
  },
  notificacao: {
    createMany: mockCreateMany,
  },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("notifyMany", () => {
  describe("lista de usuários vazia", () => {
    it("retorna imediatamente, sem consultar nem criar nada no prisma", async () => {
      await notifyMany(prisma, [], {
        titulo: "Título",
        mensagem: "Mensagem",
        tipo: "SISTEMA",
      });

      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe("nenhum candidato optou por receber (notificacoesInApp=false para todos)", () => {
    it("consulta a preferência com o where correto, mas NÃO cria nenhuma notificação", async () => {
      mockFindMany.mockResolvedValueOnce([]);

      await notifyMany(prisma, ["user-1", "user-2"], {
        titulo: "Título",
        mensagem: "Mensagem",
        tipo: "SISTEMA",
      });

      // Assertiva exata (não parcial): protege especificamente contra uma
      // regressão que remova `notificacoesInApp: true` do where, o que
      // faria o sistema notificar todo mundo, ignorando a preferência.
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { id: { in: ["user-1", "user-2"] }, notificacoesInApp: true },
        select: { id: true },
      });
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe("filtragem por opt-in (o teste mais importante deste arquivo)", () => {
    it("cria notificação SÓ para quem optou, mesmo recebendo uma lista maior de candidatos", async () => {
      // 3 candidatos passados para a função, mas o findMany (mockado) só
      // devolve 2 — simulando que "user-2" tem notificacoesInApp=false e
      // por isso não aparece no resultado da consulta.
      mockFindMany.mockResolvedValueOnce([{ id: "user-1" }, { id: "user-3" }]);

      await notifyMany(prisma, ["user-1", "user-2", "user-3"], {
        titulo: "Novo chamado",
        mensagem: "Um novo chamado foi aberto",
        tipo: "CHAMADO_CRIADO",
      });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { id: { in: ["user-1", "user-2", "user-3"] }, notificacoesInApp: true },
        select: { id: true },
      });

      expect(mockCreateMany).toHaveBeenCalledTimes(1);
      const { data: registrosCriados } = mockCreateMany.mock.calls[0][0] as {
        data: NotificacaoCriada[];
      };
      const usuarioIdsNotificados = registrosCriados.map((r) => r.usuarioId);

      expect(registrosCriados).toHaveLength(2);
      expect(usuarioIdsNotificados).toStrictEqual(["user-1", "user-3"]);
      // Redundante de propósito com o toStrictEqual acima: se algum dia a
      // ordem dos registros mudar, este .not.toContain ainda pega o caso
      // realmente grave (notificar quem não deveria), independente de ordem.
      expect(usuarioIdsNotificados).not.toContain("user-2");
    });
  });

  describe("valores padrão quando os campos opcionais são omitidos", () => {
    it('canal cai para "IN_APP", e chamadoId/mensagemId/organizacaoId/anexoId/meta caem para null', async () => {
      mockFindMany.mockResolvedValueOnce([{ id: "user-a" }, { id: "user-b" }]);

      await notifyMany(prisma, ["user-a", "user-b"], {
        titulo: "Título mínimo",
        mensagem: "Mensagem mínima",
        tipo: "SISTEMA",
      });

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            usuarioId: "user-a",
            titulo: "Título mínimo",
            mensagem: "Mensagem mínima",
            tipo: "SISTEMA",
            canal: "IN_APP",
            chamadoId: null,
            mensagemId: null,
            organizacaoId: null,
            anexoId: null,
            meta: null,
          },
          {
            usuarioId: "user-b",
            titulo: "Título mínimo",
            mensagem: "Mensagem mínima",
            tipo: "SISTEMA",
            canal: "IN_APP",
            chamadoId: null,
            mensagemId: null,
            organizacaoId: null,
            anexoId: null,
            meta: null,
          },
        ],
      });
    });
  });

  describe("todos os campos opcionais informados explicitamente", () => {
    it("usa os valores informados em vez de cair em qualquer default", async () => {
      mockFindMany.mockResolvedValueOnce([{ id: "user-x" }]);

      await notifyMany(prisma, ["user-x"], {
        titulo: "Anexo novo",
        mensagem: "Um novo anexo foi enviado",
        tipo: "ANEXO_NOVO",
        canal: "EMAIL",
        chamadoId: "chamado-001",
        mensagemId: "mensagem-001",
        organizacaoId: "org-001",
        anexoId: "anexo-001",
        meta: { url: "/dashboard" },
      });

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            usuarioId: "user-x",
            titulo: "Anexo novo",
            mensagem: "Um novo anexo foi enviado",
            tipo: "ANEXO_NOVO",
            canal: "EMAIL",
            chamadoId: "chamado-001",
            mensagemId: "mensagem-001",
            organizacaoId: "org-001",
            anexoId: "anexo-001",
            meta: { url: "/dashboard" },
          },
        ],
      });
    });
  });

  describe("uma entrada por usuário-alvo, todas com o mesmo conteúdo compartilhado", () => {
    it("gera exatamente uma entrada por usuário opt-in, todas idênticas exceto usuarioId", async () => {
      mockFindMany.mockResolvedValueOnce([{ id: "user-1" }, { id: "user-2" }, { id: "user-3" }]);

      await notifyMany(prisma, ["user-1", "user-2", "user-3"], {
        titulo: "Status alterado",
        mensagem: "O status do seu chamado mudou",
        tipo: "STATUS_ALTERADO",
        canal: "PUSH",
      });

      const { data: registrosCriados } = mockCreateMany.mock.calls[0][0] as {
        data: NotificacaoCriada[];
      };

      expect(registrosCriados).toHaveLength(3);
      for (const registro of registrosCriados) {
        expect(registro.titulo).toBe("Status alterado");
        expect(registro.mensagem).toBe("O status do seu chamado mudou");
        expect(registro.tipo).toBe("STATUS_ALTERADO");
        expect(registro.canal).toBe("PUSH");
      }

      const idsUsados = registrosCriados.map((r) => r.usuarioId);
      expect(idsUsados).toStrictEqual(["user-1", "user-2", "user-3"]);
    });
  });
});