import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateNotificationRuleSchema } from "./notifications.js";

describe("updateNotificationRuleSchema (edición de reglas de correo)", () => {
  it("acepta una edición parcial válida (solo enabled)", () => {
    const parsed = updateNotificationRuleSchema.safeParse({ enabled: false });
    assert.equal(parsed.success, true);
  });

  it("acepta destinatarios y asunto juntos", () => {
    const parsed = updateNotificationRuleSchema.safeParse({
      recipients: ["rh@tsc.com.mx", "gerencia@tsc.com.mx"],
      subject: "Resultado de examen"
    });
    assert.equal(parsed.success, true);
  });

  it("rechaza un cuerpo vacío (nada que actualizar)", () => {
    const parsed = updateNotificationRuleSchema.safeParse({});
    assert.equal(parsed.success, false);
  });

  it("rechaza destinatarios que no son correos", () => {
    const parsed = updateNotificationRuleSchema.safeParse({ recipients: ["no-es-correo"] });
    assert.equal(parsed.success, false);
  });

  it("rechaza una lista de destinatarios vacía", () => {
    const parsed = updateNotificationRuleSchema.safeParse({ recipients: [] });
    assert.equal(parsed.success, false);
  });

  it("rechaza un asunto vacío", () => {
    const parsed = updateNotificationRuleSchema.safeParse({ subject: "" });
    assert.equal(parsed.success, false);
  });
});
