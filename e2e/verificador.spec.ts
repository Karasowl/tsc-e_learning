import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import { API_URL, storageStatePath } from "./auth-session";

/**
 * Verificador público de diplomas (pantalla de acceso, sin sesión).
 *
 * Cubre en navegador real el widget que el QA del 2026-07-19 encontró roto: el
 * <form> del verificador vivía DENTRO del <form> de login, el navegador
 * descartaba el form anidado y "Verificar" disparaba el envío nativo del login
 * (la página se recargaba y el código jamás se consultaba). Los tests del API
 * no podían verlo porque el endpoint siempre funcionó; solo se manifestaba en
 * el DOM. Este spec fija la estructura correcta de una vez por todas.
 *
 * El código de verificación sembrado se obtiene vía API con el token del admin
 * (deriva de usuario:curso:fecha, no es un literal estable para asertar).
 */

async function seededVerificationCode(): Promise<string> {
  const state = JSON.parse(readFileSync(storageStatePath("admin"), "utf8")) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  const token = state.origins[0]?.localStorage.find((item) => item.name === "tsc_token")?.value;
  if (!token) {
    throw new Error("No hay tsc_token de admin sembrado (global-setup).");
  }
  const api = await pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` }
  });
  const res = await api.get("/certificates");
  if (!res.ok()) {
    throw new Error(`GET /certificates respondió HTTP ${res.status()}`);
  }
  const { certificates } = (await res.json()) as {
    certificates: Array<{ status: string; verificationCode: string; user: { displayName: string } }>;
  };
  await api.dispose();
  const cert = certificates.find((c) => c.user.displayName === "Marcos Martinez" && c.status === "ISSUED");
  if (!cert) {
    throw new Error("No se encontró el diploma sembrado vigente de Marcos Martinez.");
  }
  return cert.verificationCode;
}

test.describe("verificador público de diplomas (1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("valida el diploma sembrado y rechaza un código inexistente", async ({ page }) => {
    const code = await seededVerificationCode();

    await page.goto("/");
    await page.getByRole("button", { name: "Verificar un diploma" }).click();
    const panel = page.locator(".verify-panel");
    await expect(panel).toBeVisible();

    // Código real => diploma auténtico con nombre y curso.
    await panel.locator("input").fill(code);
    await panel.getByRole("button", { name: "Verificar" }).click();
    const ok = panel.locator(".verify-result.ok");
    await expect(ok).toContainText("Diploma auténtico", { timeout: 20_000 });
    await expect(ok).toContainText("Marcos Martinez");
    await expect(ok).toContainText("Proteccion Ejecutiva");

    // La página NO debe haberse recargado (el bug del form anidado navegaba a
    // "/?": el panel se cerraba y el resultado se perdía).
    await expect(panel).toBeVisible();

    // Código inexistente => rechazo claro, sin salir de la pantalla.
    await panel.locator("input").fill("codigo-inexistente-qa");
    await panel.getByRole("button", { name: "Verificar" }).click();
    await expect(panel.locator(".error-line")).toHaveText("No encontramos un diploma con ese código.", {
      timeout: 20_000
    });
  });
});
