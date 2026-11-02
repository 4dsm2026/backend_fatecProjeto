import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { SugestaoResponderSchema } from "../../../src/validators/sugestoes";
import { responderSugestao } from "../../../src/core/sugestoes/sugestoes.service";

const suggestionDelegate = {
  findUnique: vi.fn(),
  updateMany: vi.fn(),
};
const prismaMock = { sugestao: suggestionDelegate } as unknown as PrismaClient;

const admin = { staffId: "admin-1", role: "ADMINISTRADOR" as const };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("responderSugestao", () => {
  it("requires non-empty response content in the request schema", () => {
    expect(SugestaoResponderSchema.safeParse({
      params: { id: "suggestion-1" },
      body: { status: "RESPONDIDO" },
    }).success).toBe(false);
    expect(SugestaoResponderSchema.safeParse({
      params: { id: "suggestion-1" },
      body: { resposta: "   " },
    }).success).toBe(false);
  });

  it("rejects callers outside the staff roles in the service", async () => {
    await expect(
      responderSugestao(prismaMock, "suggestion-1", { resposta: "Resposta" }, {
        staffId: "user-1",
        role: "USUARIO",
      }),
    ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
    expect(suggestionDelegate.findUnique).not.toHaveBeenCalled();
  });

  it("validates response content again inside the service", async () => {
    await expect(
      responderSugestao(prismaMock, "suggestion-1", { resposta: "   " }, admin),
    ).rejects.toMatchObject({ kind: "bad-request", status: 400 });
    expect(suggestionDelegate.findUnique).not.toHaveBeenCalled();
  });

  it("sets the response, final status, and authenticated responder atomically", async () => {
    const updatedSuggestion = {
      id: "suggestion-1",
      status: "RESPONDIDO",
      resposta: "Resposta oficial",
      respondidoPorId: admin.staffId,
    };
    suggestionDelegate.findUnique
      .mockResolvedValueOnce({ id: "suggestion-1", status: "NAO_RESPONDIDO", resposta: null } as never)
      .mockResolvedValueOnce(updatedSuggestion as never);
    suggestionDelegate.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    await expect(
      responderSugestao(
        prismaMock,
        "suggestion-1",
        { resposta: "Resposta oficial" },
        admin,
      ),
    ).resolves.toEqual(updatedSuggestion);

    expect(suggestionDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "suggestion-1", status: "NAO_RESPONDIDO", resposta: null },
      data: expect.objectContaining({
        resposta: "Resposta oficial",
        status: "RESPONDIDO",
        respondidoPorId: admin.staffId,
      }),
    }));
  });

  it("does not overwrite a completed response", async () => {
    suggestionDelegate.findUnique.mockResolvedValueOnce({
      id: "suggestion-1",
      status: "RESPONDIDO",
      resposta: "Resposta anterior",
    } as never);

    await expect(
      responderSugestao(
        prismaMock,
        "suggestion-1",
        { resposta: "Tentativa de alteração" },
        admin,
      ),
    ).rejects.toMatchObject({ kind: "conflict", status: 409 });
    expect(suggestionDelegate.updateMany).not.toHaveBeenCalled();
  });

  it("detects a concurrent response instead of overwriting it", async () => {
    suggestionDelegate.findUnique.mockResolvedValueOnce({
      id: "suggestion-1",
      status: "NAO_RESPONDIDO",
      resposta: null,
    } as never);
    suggestionDelegate.updateMany.mockResolvedValueOnce({ count: 0 } as never);

    await expect(
      responderSugestao(prismaMock, "suggestion-1", { resposta: "Resposta" }, admin),
    ).rejects.toMatchObject({ kind: "conflict", status: 409 });
  });
});
