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
// Evidencia de la Ola 1 para QA visual (persiste en el repo, ignorada por git).
const OLA1_SHOTS = join(__dirname, "..", "tmp-qa", "ola1");

mkdirSync(QA_SHOTS, { recursive: true });
mkdirSync(OLA1_SHOTS, { recursive: true });

function shot(name: string) {
  return join(QA_SHOTS, name);
}

function ola1Shot(name: string) {
  return join(OLA1_SHOTS, name);
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

  // G-01: tras ENVIAR un examen, la pantalla de resultado permanece visible y NO
  // rebota a la Lección 1. Antes de la Ola 1, loadCourse reseteaba quizAttempt y la
  // lección activa al refrescar, así que el resultado desaparecía al instante.
  test("G-01: al enviar el examen, el resultado permanece (no rebota a la Lección 1)", async ({ page }) => {
    await loginGuardia(page);
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // Abrir el examen del curso (el guardia está inscrito; Intramuros 0%).
    const examRow = page.locator(".quiz-row", { hasText: "Examen final de Seguridad Intramuros" });
    await expect(examRow).toBeVisible({ timeout: 20_000 });
    await examRow.click();

    // Se monta el panel de evaluación con el CTA de envío.
    await expect(page.getByRole("heading", { name: "Evaluación" })).toBeVisible({ timeout: 20_000 });
    const submit = page.getByRole("button", { name: "Enviar evaluación" });
    await expect(submit).toBeVisible();

    // Enviar sin responder ⇒ 0% ⇒ "No aprobado". Esperamos la respuesta del submit
    // (tras la cual corre loadCourse con preserveAttempt) para observar el estado final.
    const submitResp = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST"
    );
    await submit.click();
    await submitResp;
    // Dejar asentar el refresco de temario/inscripción que dispara el submit.
    await page.waitForTimeout(1500);

    // La pantalla de resultado está y PERMANECE (no se ve el panel de lección).
    const result = page.locator(".quiz-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("No aprobado");
    await expect(page.locator(".quiz-result-score")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Volver al curso" })).toBeVisible();
    // Anti-rebote: NO estamos en una lección (no hay CTA de completar lección).
    await expect(page.getByRole("button", { name: "Marcar completada" })).toHaveCount(0);
    await page.screenshot({ path: ola1Shot("guardia-examen-resultado-persistente.png"), fullPage: true });
  });

  // G-06: completar una lección que NO es la primera deja al usuario en esa lección
  // (la activa se conserva si sigue existiendo tras recargar), no en la Lección 1.
  test("G-06: completar una lección no-primera deja al usuario en ESA lección", async ({ page }) => {
    const firstTitle = "Introduccion a Seguridad Intramuros";
    const targetTitle = "Video demostrativo: Seguridad Intramuros";

    await loginGuardia(page);
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // Al abrir, la lección activa es la primera. Navegar a una lección posterior.
    const targetRow = page.locator(".lesson-row", { hasText: targetTitle });
    await expect(targetRow).toBeVisible({ timeout: 20_000 });
    await targetRow.click();
    await expect(page.locator(".lesson-row.active")).toContainText(targetTitle);

    // Completar esa lección (no la primera).
    const complete = page.getByRole("button", { name: "Marcar completada" });
    await expect(complete).toBeVisible({ timeout: 20_000 });
    const completeResp = page.waitForResponse(
      (r) => r.url().includes("/complete") && r.request().method() === "POST"
    );
    await complete.click();
    await completeResp;
    // Dejar asentar el loadCourse que refresca el temario tras completar.
    await page.waitForTimeout(1500);

    // Seguimos en la MISMA lección (no rebotamos a la primera).
    await expect(page.locator(".lesson-row.active")).toContainText(targetTitle);
    await expect(page.locator(".lesson-row.active")).not.toContainText(firstTitle);
    // Y quedó marcada como completada (el CTA pasó a "Completada").
    await expect(page.getByRole("button", { name: "Completada" })).toBeVisible();
    await page.screenshot({ path: ola1Shot("guardia-completar-leccion-no-primera.png"), fullPage: true });
  });
});
