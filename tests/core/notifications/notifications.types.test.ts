import { describe, expect, it } from "vitest";
import {
  BooleanStringSchema,
  ListNotificationsQuerySchema,
  NotificationIdParamsSchema,
  PatchAllNotificationsBodySchema,
  PatchNotificationBodySchema,
} from "../../../src/core/notifications/notifications.types.js";

describe("notifications.types (Schemas & Bug S7)", () => {
  it("converte 'true' para true e 'false' para false no BooleanStringSchema (Bug S7)", () => {
    expect(BooleanStringSchema.parse("true")).toBe(true);
    expect(BooleanStringSchema.parse("false")).toBe(false);
    expect(BooleanStringSchema.parse(undefined)).toBeUndefined();
  });

  it("rejeita valores inválidos no BooleanStringSchema", () => {
    expect(() => BooleanStringSchema.parse("1")).toThrow();
    expect(() => BooleanStringSchema.parse("qualquer")).toThrow();
  });

  it("aplica defaults de paginação base 0 (page=0, size=20) no ListNotificationsQuerySchema", () => {
    const parsed = ListNotificationsQuerySchema.parse({});
    expect(parsed.page).toBe(0);
    expect(parsed.size).toBe(20);
    expect(parsed.apenasNaoLidas).toBeUndefined();
    expect(parsed.arquivadas).toBeUndefined();
  });

  it("rejeita page negativo ou size acima de 100 na listagem", () => {
    expect(() => ListNotificationsQuerySchema.parse({ page: -1 })).toThrow();
    expect(() => ListNotificationsQuerySchema.parse({ size: 101 })).toThrow();
    expect(() => ListNotificationsQuerySchema.parse({ size: 0 })).toThrow();
  });

  it("valida NotificationIdParamsSchema exigindo id não vazio", () => {
    expect(NotificationIdParamsSchema.parse({ id: "notif-123" })).toEqual({
      id: "notif-123",
    });
    expect(() => NotificationIdParamsSchema.parse({ id: "" })).toThrow();
  });

  it("valida PatchNotificationBodySchema exigindo pelo menos lida ou arquivada", () => {
    expect(PatchNotificationBodySchema.parse({ lida: true })).toEqual({
      lida: true,
    });
    expect(PatchNotificationBodySchema.parse({ arquivada: false })).toEqual({
      arquivada: false,
    });
    expect(
      PatchNotificationBodySchema.parse({ lida: false, arquivada: true })
    ).toEqual({
      lida: false,
      arquivada: true,
    });
    expect(() => PatchNotificationBodySchema.parse({})).toThrow();
  });

  it("valida PatchAllNotificationsBodySchema exigindo lida: true", () => {
    expect(PatchAllNotificationsBodySchema.parse({ lida: true })).toEqual({
      lida: true,
    });
    expect(() =>
      PatchAllNotificationsBodySchema.parse({ lida: false })
    ).toThrow();
  });
});