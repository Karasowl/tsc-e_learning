import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * QA de la CONSOLA DEL INSTRUCTOR (rol TEACHER puro) — desktop 1280x800.
 * Verifica, contra la build real y datos reales (sin mocks):
 *  - Login instructor -> aterriza en la consola de marca (NO el app-shell viejo).
 *  - La lista muestra los cursos con CONTEOS REALES (_count, no "0 secciones") +
 *    pill de versión + estado.
 *  - Abrir un curso: breadcrumb, pills de estado/versión y la tira de navtabs.
 *  - Resultados muestra el SELLO real del intento sembrado (hash + rulesVersion +
 *    umbral congelado 80%).
 *  - Reglas surfacea el umbral vivo (80%). Vista previa y Anuncios renderizan.
 *  - Publicar crea una versión nueva (v1 -> v2) reflejada en el pill.
 *
 * Datos sembrados (password comun "Capacita2026!"): instructor@tsc.local imparte
 * 3 cursos PUBLICADOS v1; el guardia Marcos Martinez tiene en "Proteccion
 * Ejecutiva" un intento APROBADO y SELLADO (umbral congelado 80%, rulesVersion 1).
 */

const API_URL = "http://localhost:4000";
const PASSWORD = "Capacita2026!";
const INSTRUCTOR = "instructor@tsc.local";
const QA_SHOTS =
  "/tmp/claude-1000/-home-karasowl-dev-tsc-e-learning/64f53584-2202-4228-a0bd-dd9736a5f90c/scratchpad/qa-instructor";

mkdirSync(QA_SHOTS, { recursive: true });

function shot(name: string) {
  return join(QA_SHOTS, name);
}

async function waitForApi(request: APIRequestContext) {
  for (let i = 0; i < 60; i++) {
    try {
      await request.get(`${API_URL}/`, { failOnStatusCode: false, timeout: 4000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`El API en ${API_URL} no respondió a tiempo.`);
}

async function loginInstructor(page: Page) {
  await waitForApi(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await page.getByLabel("Correo").fill(INSTRUCTOR);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // La consola del instructor reemplaza al login (NO es el app-shell de escritorio).
  await expect(page.locator("main.tconsole-shell")).toBeVisible({ timeout: 30_000 });
}

test.describe("instructor · consola de marca (1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("lista con conteos reales, navtabs, sello, reglas y vista previa", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

    await loginInstructor(page);

    // Marca visible (sin sidebar) + título de la lista.
    await expect(page.locator(".tconsole-wordmark")).toHaveText("CAPACITA");
    await expect(page.locator("main.app-shell")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible();

    // 3 cursos del instructor, con CONTEOS REALES (no "0 secciones") + versión + estado.
    await expect(page.locator(".tconsole-card")).toHaveCount(3, { timeout: 20_000 });
    const proteccionCard = page.locator(".tconsole-card", { hasText: "Proteccion Ejecutiva" });
    await expect(proteccionCard).toContainText("2 secciones");
    await expect(proteccionCard).toContainText("3 clases");
    await expect(proteccionCard).toContainText("1 exámenes");
    await expect(proteccionCard.locator(".tconsole-version")).toHaveText("v1");
    await expect(proteccionCard).toContainText("Publicado");
    await page.screenshot({ path: shot("01-lista.png"), fullPage: true });

    // Abrir el curso: breadcrumb, pills de estado/versión, tira de navtabs.
    await proteccionCard.click();
    await expect(page.locator(".tconsole-crumb.is-current").last()).toHaveText("Proteccion Ejecutiva");
    await expect(page.locator(".tconsole-topbar-actions .tconsole-version")).toHaveText("v1");
    await expect(page.locator(".tconsole-topbar-actions")).toContainText("Publicado");
    await expect(page.locator(".tconsole-tab")).toHaveCount(6);

    // Estructura (default) monta la autoría existente dentro del shell.
    await expect(page.getByRole("heading", { name: "Contenido del curso" })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("02-estructura.png"), fullPage: true });

    // Resultados: el SELLO real del intento sembrado.
    await page.locator(".tconsole-tab", { hasText: "Resultados" }).click();
    const sealedRow = page.locator(".tconsole-report tbody tr", { hasText: "Marcos Martinez" });
    await expect(sealedRow).toBeVisible({ timeout: 20_000 });
    await expect(sealedRow).toContainText("Aprobado");
    // Umbral congelado 80% marcado "sellado".
    await expect(sealedRow.locator(".tconsole-threshold-main")).toContainText("80%");
    await expect(sealedRow).toContainText("sellado");
    // Sello: candado + hash de 8 hex + versión de reglas v1.
    await expect(sealedRow.locator(".tconsole-seal")).toBeVisible();
    await expect(sealedRow.locator(".tconsole-seal-tag")).toHaveText(/^[0-9a-f]{8}$/);
    await expect(sealedRow.locator(".tconsole-seal")).toContainText("v1");
    await page.screenshot({ path: shot("03-resultados-sello.png"), fullPage: true });

    // Reglas: umbral vivo (80%) editable por examen.
    await page.locator(".tconsole-tab", { hasText: "Reglas" }).click();
    const ruleCard = page.locator(".tconsole-rule", { hasText: "Examen final de Proteccion Ejecutiva" });
    await expect(ruleCard).toBeVisible({ timeout: 20_000 });
    await expect(ruleCard.getByLabel("% para aprobar (vivo)")).toHaveValue("80");
    await page.screenshot({ path: shot("04-reglas.png"), fullPage: true });

    // Vista previa: temario como lo ve un colaborador.
    await page.locator(".tconsole-tab", { hasText: "Vista previa" }).click();
    await expect(page.locator(".tconsole-preview-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tconsole-preview-module").first()).toBeVisible();

    // Anuncios: placeholder honesto (no simula datos).
    await page.locator(".tconsole-tab", { hasText: "Anuncios" }).click();
    await expect(page.getByRole("heading", { name: "Anuncios del curso" })).toBeVisible();
    await expect(page.locator(".tconsole-soon")).toContainText("En construcción");

    expect(pageErrors, `errores JS sin controlar:\n${pageErrors.join("\n")}`).toEqual([]);
    const appConsoleErrors = consoleErrors.filter((text) => {
      const t = text.toLowerCase();
      return !(
        t.includes("failed to load resource") ||
        t.includes("favicon") ||
        t.includes("accounts.google") ||
        t.includes("youtube") ||
        t.includes("gsi") ||
        t.includes("net::err")
      );
    });
    // eslint-disable-next-line no-console
    console.log("[instructor] console errors (crudos):", JSON.stringify(consoleErrors, null, 2));
    expect.soft(appConsoleErrors, `errores de consola de la app:\n${appConsoleErrors.join("\n")}`).toEqual([]);
  });

  test("publicar corta una versión nueva: v1 -> v2 en el pill", async ({ page }) => {
    await loginInstructor(page);

    // Crear un curso temporal (nace como Borrador v1) y abrirlo en la consola.
    const title = `QA Publicar ${Date.now()}`;
    await page.getByLabel("Título del curso nuevo").fill(title);
    await page.getByRole("button", { name: "Crear curso" }).click();

    // Aterriza en Estructura con topbar de Borrador v1 y CTA Publicar.
    await expect(page.locator(".tconsole-topbar-actions")).toContainText("Borrador", { timeout: 20_000 });
    await expect(page.locator(".tconsole-topbar-actions .tconsole-version")).toHaveText("v1");
    const publishCta = page.getByRole("button", { name: "Publicar", exact: true });
    await expect(publishCta).toBeVisible();

    // Modal de publicación: refleja el salto v1 -> v2.
    await publishCta.click();
    const modal = page.locator(".tconsole-publish-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".tconsole-version").first()).toHaveText("v1");
    await expect(modal.locator(".tconsole-version-next")).toHaveText("v2");
    await page.screenshot({ path: shot("05-publicar-modal.png"), fullPage: true });

    // Confirmar: el pill de versión sube a v2 y el estado pasa a Publicado.
    await modal.getByRole("button", { name: "Publicar v2" }).click();
    await expect(modal).toBeHidden({ timeout: 20_000 });
    await expect(page.locator(".tconsole-topbar-actions .tconsole-version")).toHaveText("v2");
    await expect(page.locator(".tconsole-topbar-actions")).toContainText("Publicado");
    await page.screenshot({ path: shot("06-publicado-v2.png"), fullPage: true });

    // Limpieza: eliminar el curso temporal desde Ajustes (zona de peligro).
    await page.locator(".tconsole-tab", { hasText: "Ajustes" }).click();
    await page.getByRole("button", { name: "Eliminar curso" }).click();
    await page.locator(".confirm-panel").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({ timeout: 20_000 });
    // El curso temporal ya no aparece en la lista.
    await expect(page.locator(".tconsole-card", { hasText: title })).toHaveCount(0);
  });
});
