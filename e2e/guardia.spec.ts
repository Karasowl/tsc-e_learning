import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * QA de la cáscara móvil del GUARDIA (estudiante) — "carrera del guardia".
 * Viewport 390x844. Verifica, contra la build real y datos reales (sin mocks):
 *  - Login guardia → aterriza en la tab RANGO con rango "Guardia", XP y barra.
 *  - Las 4 tabs (Cursos/Logros/Rango/Perfil) renderizan datos reales sin errores.
 *  - Completar UNA lección del curso 0% "Seguridad Intramuros" otorga +10 XP real
 *    (toast) y el XP en Rango sube (460 → 470).
 *
 * El progreso del guardia se resetea en global-setup.ts antes de la corrida, así
 * que el +10 es reproducible una y otra vez.
 */

const API_URL = "http://localhost:4000";
const PASSWORD = "Capacita2026!";
const GUARDIA = "guardia@tsc.local";
// Capturas del QA del guardia (ruta indicada por la unidad).
const QA_SHOTS =
  "/tmp/claude-1000/-home-karasowl-dev-tsc-e-learning/64f53584-2202-4228-a0bd-dd9736a5f90c/scratchpad/qa-guardia";

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

async function loginGuardia(page: Page) {
  await waitForApi(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await page.getByLabel("Correo").fill(GUARDIA);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // La cáscara móvil del guardia reemplaza al login (NO es el app-shell de escritorio).
  await expect(page.locator("main.guard-shell")).toBeVisible({ timeout: 30_000 });
  // El badge dev de Next (portal fijo en una esquina, ausente en producción) se
  // solapa con la tabbar inferior en dev; lo ocultamos solo para capturas limpias.
  // Los clicks de tab van por dispatchEvent, así que no dependen de esto.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);
}

// Los destinos de la tabbar inferior. Se despacha el click por evento (no por
// coordenadas) para no chocar con el badge dev de Next, que en dev se solapa con
// la tabbar fija. En producción no existe ese badge.
function goToTab(page: Page, name: "Cursos" | "Logros" | "Rango" | "Perfil") {
  return page.locator(".guard-tabbar").getByRole("button", { name }).dispatchEvent("click");
}

test.describe("guardia · cáscara móvil (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("aterriza en Rango y las 4 tabs renderizan datos reales sin errores", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

    await loginGuardia(page);

    // Aterrizaje = tab RANGO. Marca visible + rango "Guardia" + XP + barra de avance.
    await expect(page.locator(".guard-wordmark")).toHaveText("CAPACITA");
    await expect(page.locator(".guard-rankchip-name")).toHaveText("Guardia");
    await expect(page.locator(".rank-name")).toHaveText("Guardia");
    await expect(page.locator(".rank-xp strong")).toHaveText("450");
    await expect(page.locator(".rank-hero .guard-progress")).toBeVisible();
    // "Continuar tu misión": curso EN PROGRESO real (Custodia 66%).
    await expect(page.locator(".mission-card")).toContainText("Custodia de Mercancia");
    // Identidad real (employeeCode del /me, no del login).
    await expect(page.locator(".guard-topbar .guard-eyebrow")).toContainText("TSC-0427");
    await expect(page.locator(".guard-name")).toHaveText("Marcos Martinez");
    await page.screenshot({ path: shot("01-rango.png"), fullPage: true });

    // Tab CURSOS: catálogo real (los 3 cursos del guardia).
    await goToTab(page, "Cursos");
    await expect(page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByRole("button", { name: /Abrir curso/ })).toHaveCount(3);
    await page.screenshot({ path: shot("02-cursos.png"), fullPage: true });

    // Tab LOGROS: escalafón de 6 rangos + insignias reales (/me/badges: 3/4).
    await goToTab(page, "Logros");
    await expect(page.getByRole("heading", { name: "Escalafón del guardia" })).toBeVisible();
    await expect(page.locator(".rank-ladder .ladder-step")).toHaveCount(6);
    await expect(page.locator(".ladder-step.current")).toContainText("Guardia");
    await expect(page.locator(".badge-card").first()).toBeVisible();
    await page.screenshot({ path: shot("03-logros.png"), fullPage: true });

    // Tab PERFIL: perfil real gamificado (editar + rango/XP + código + salir).
    await goToTab(page, "Perfil");
    await expect(page.getByRole("heading", { name: "Editar perfil" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".guard-rank-pill")).toContainText("Guardia");
    // "TSC-0427" aparece en la barra superior y en el dato del perfil; fijamos el dato exacto.
    await expect(page.getByText("TSC-0427", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await page.screenshot({ path: shot("04-perfil.png"), fullPage: true });

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
    console.log("[guardia] console errors (crudos):", JSON.stringify(consoleErrors, null, 2));
    expect.soft(appConsoleErrors, `errores de consola de la app:\n${appConsoleErrors.join("\n")}`).toEqual([]);
  });

  test("completar una lección de Intramuros otorga +10 XP real y sube el XP en Rango", async ({ page }) => {
    await loginGuardia(page);

    // XP inicial en Rango (baseline sembrado tras el reset).
    await expect(page.locator(".rank-xp strong")).toHaveText("450");

    // Abrir el curso 0% "Seguridad Intramuros".
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // La primera lección queda activa: el panel muestra "Marcar completada".
    const complete = page.getByRole("button", { name: "Marcar completada" });
    await expect(complete).toBeVisible({ timeout: 20_000 });
    await complete.click();

    // Toast de XP real (+10 = XP_LESSON_COMPLETED del servidor).
    await expect(page.getByText("+10 XP", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("05-toast-xp.png"), fullPage: true });

    // El XP en Rango subió 450 → 460.
    await goToTab(page, "Rango");
    await expect(page.locator(".rank-xp strong")).toHaveText("460");
    await page.screenshot({ path: shot("06-rango-tras-xp.png"), fullPage: true });
  });
});
