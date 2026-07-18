import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";
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
// Evidencia de la Ola 2 · Fase C (gating del guardia) para QA visual.
const OLA2C_SHOTS = join(__dirname, "..", "tmp-qa", "ola2-c");

mkdirSync(QA_SHOTS, { recursive: true });
mkdirSync(OLA1_SHOTS, { recursive: true });
mkdirSync(OLA2C_SHOTS, { recursive: true });

function shot(name: string) {
  return join(QA_SHOTS, name);
}

function ola1Shot(name: string) {
  return join(OLA1_SHOTS, name);
}

function ola2cShot(name: string) {
  return join(OLA2C_SHOTS, name);
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
  // El endpoint /auth/login limita a 10 logins/min por IP (rate-limit real del
  // producto). Al correr TODA la suite, los logins previos (admin + los propios
  // tests del guardia) llenan esa ventana y un login del guardia puede recibir 429,
  // que la UI deja en la pantalla de acceso. Reintentamos con una espera corta: al
  // pasar los segundos los logins viejos salen de la ventana deslizante y se libera
  // cupo. NO toca el rate-limit del producto; solo hace robusto el e2e en su contra.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    await page.getByLabel("Correo").fill(GUARDIA);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    // La cáscara móvil del guardia reemplaza al login (NO es el app-shell de escritorio).
    try {
      await page
        .locator("main.guard-shell")
        .waitFor({ state: "visible", timeout: attempt === MAX_ATTEMPTS ? 30_000 : 8_000 });
      break;
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error("La cáscara del guardia no cargó tras reintentar el login (¿rate-limit persistente?).");
      }
      // Login rechazado (probable 429): espera a que se libere cupo y reintenta.
      await page.waitForTimeout(12_000);
    }
  }
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

// Con el gating de la Fase C, varias pruebas completan lecciones/examen de
// "Seguridad Intramuros" y dependen de que ese curso empiece en 0% (candados
// visibles, examen bloqueado). Como corren en serie contra la MISMA base, cada
// prueba restaura el baseline sembrado del guardia (Intramuros 0%, XP 450,
// Custodia 66%, notificación sin leer) antes de ejecutarse. No toca el intento
// SELLADO de Proteccion Ejecutiva del que dependen otros specs.
function resetGuardiaBaseline() {
  execSync("pnpm --filter @tsc-capacita/db run db:reset-guardia", { stdio: "ignore" });
}

test.beforeEach(() => {
  resetGuardiaBaseline();
});

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

  // G-01 (reformada al flujo GATED de la Fase C): el examen de Intramuros nace
  // BLOQUEADO (0% de lecciones). El guardia debe completar TODAS las lecciones en
  // orden para desbloquearlo; luego responde el stepper, envía y la pantalla de
  // resultado PERMANECE visible (no rebota a la Lección 1). El bloqueo duro (409)
  // convierte el intento directo del examen en imposible, así que la prueba recorre
  // el camino real: desbloquear → responder → enviar → resultado persistente.
  test("G-01: examen gated · desbloquear, enviar y el resultado permanece (no rebota)", async ({ page }) => {
    await loginGuardia(page);
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // El examen arranca BLOQUEADO: fila candado + copy de desbloqueo, no clicable.
    const examLockedRow = page.locator(".quiz-row.exam-locked");
    await expect(examLockedRow).toBeVisible({ timeout: 20_000 });
    await expect(examLockedRow).toContainText(
      "Completa todas las lecciones para desbloquear el examen"
    );

    // Completar TODAS las lecciones en orden (cada una desbloquea la siguiente).
    await completeAllLessonsInOrder(page);

    // El examen se DESBLOQUEA: la fila candado desaparece y aparece la fila clicable.
    await expect(page.locator(".quiz-row.exam-locked")).toHaveCount(0);
    const examRow = page.locator(".quiz-row", { hasText: "Examen final de Seguridad Intramuros" });
    await expect(examRow).toBeVisible({ timeout: 20_000 });
    await examRow.click();

    // Stepper: header "Pregunta 1 de N" (no un volcado de todas las preguntas).
    await expect(page.locator(".quiz-stepper")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^Pregunta 1 de \d+$/ })).toBeVisible();
    await expect(page.locator(".quiz-progress-segments")).toBeVisible();
    await page.screenshot({ path: ola2cShot("examen-stepper-pregunta-1.png"), fullPage: true });

    // Avanzar el stepper respondiendo cada pregunta (la 2ª opción es incorrecta en
    // ambas: fuerza un "No aprobado" determinista, con Reintentar + Volver visibles).
    await answerWrongAndAdvance(page);

    // Enviar la evaluación y esperar la respuesta del submit (tras la cual corre
    // loadCourse con preserveAttempt, que NO debe borrar el resultado).
    const submit = page.getByRole("button", { name: "Enviar evaluación" });
    await expect(submit).toBeVisible();
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
    await page.screenshot({ path: ola2cShot("examen-resultado-persistente.png"), fullPage: true });
    await page.screenshot({ path: ola1Shot("guardia-examen-resultado-persistente.png"), fullPage: true });
  });

  // G-06 (reformada al flujo GATED de la Fase C): la Lección 2 NACE bloqueada
  // (secuencial). Al completar la Lección 1 (primera, disponible) la 2 se desbloquea;
  // se navega a ella, se completa, y el usuario SIGUE en la Lección 2 (no rebota a la
  // 1). Mantiene el espíritu de G-06 (la lección activa se conserva) dentro del gating.
  test("G-06: gated · completar la Lección 1 desbloquea la 2 y completarla te deja en ELLA", async ({ page }) => {
    const firstTitle = "Introduccion a Seguridad Intramuros";
    const targetTitle = "Video demostrativo: Seguridad Intramuros";

    await loginGuardia(page);
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // La Lección 2 arranca BLOQUEADA (secuencial): no se puede saltar a ella.
    await expect(page.locator(".lesson-row.locked", { hasText: targetTitle })).toBeVisible({
      timeout: 20_000
    });

    // La Lección 1 (primera) está activa y disponible: completarla.
    await expect(page.locator(".lesson-row.active")).toContainText(firstTitle);
    const complete1 = page.getByRole("button", { name: "Marcar completada" });
    await expect(complete1).toBeVisible({ timeout: 20_000 });
    const resp1 = page.waitForResponse(
      (r) => r.url().includes("/complete") && r.request().method() === "POST"
    );
    await complete1.click();
    await resp1;
    await page.waitForTimeout(1500);

    // La Lección 2 SE DESBLOQUEA (deja de ser .lesson-row.locked) y es clicable.
    await expect(page.locator(".lesson-row.locked", { hasText: targetTitle })).toHaveCount(0);
    const targetRow = page.locator(".lesson-row", { hasText: targetTitle });
    await expect(targetRow).toBeVisible({ timeout: 20_000 });
    await targetRow.click();
    await expect(page.locator(".lesson-row.active")).toContainText(targetTitle);

    // Completar la Lección 2 (no la primera).
    const complete2 = page.getByRole("button", { name: "Marcar completada" });
    await expect(complete2).toBeVisible({ timeout: 20_000 });
    const resp2 = page.waitForResponse(
      (r) => r.url().includes("/complete") && r.request().method() === "POST"
    );
    await complete2.click();
    await resp2;
    // Dejar asentar el loadCourse que refresca el temario tras completar.
    await page.waitForTimeout(1500);

    // Seguimos en la MISMA lección (no rebotamos a la primera).
    await expect(page.locator(".lesson-row.active")).toContainText(targetTitle);
    await expect(page.locator(".lesson-row.active")).not.toContainText(firstTitle);
    // Y quedó marcada como completada (el CTA pasó a "Completada").
    await expect(page.getByRole("button", { name: "Completada" })).toBeVisible();
    await page.screenshot({ path: ola1Shot("guardia-completar-leccion-no-primera.png"), fullPage: true });
    await page.screenshot({ path: ola2cShot("leccion-2-desbloqueada-completada.png"), fullPage: true });
  });
});

// Helper: completa las lecciones del curso abierto EN ORDEN. Cada lección
// desbloquea la siguiente (gating secuencial), así que se resuelven de una en una.
// Antes de completar, la fila destino debe estar disponible (no .locked).
async function completeLessonByTitle(page: Page, title: string) {
  const row = page.locator(".lesson-row:not(.locked)", { hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.locator(".lesson-row.active")).toContainText(title);
  const complete = page.getByRole("button", { name: "Marcar completada" });
  await expect(complete).toBeVisible({ timeout: 20_000 });
  const resp = page.waitForResponse(
    (r) => r.url().includes("/complete") && r.request().method() === "POST"
  );
  await complete.click();
  await resp;
  await page.waitForTimeout(1200);
  await expect(page.getByRole("button", { name: "Completada" })).toBeVisible();
}

// Completa las 3 lecciones de "Seguridad Intramuros" en orden de lectura para
// desbloquear el examen.
async function completeAllLessonsInOrder(page: Page) {
  await completeLessonByTitle(page, "Introduccion a Seguridad Intramuros");
  await completeLessonByTitle(page, "Video demostrativo: Seguridad Intramuros");
  await completeLessonByTitle(page, "Protocolo operativo de Seguridad Intramuros");
}

// Recorre el stepper del examen respondiendo cada pregunta con una opción
// INCORRECTA (se excluye la respuesta correcta por texto, así es determinista
// aunque el orden de opciones cambie), pulsando "Siguiente" hasta la última
// pregunta (donde queda "Enviar evaluación"). Fuerza un "No aprobado" reproducible.
async function answerWrongAndAdvance(page: Page) {
  // Respuestas correctas del examen de Intramuros (seed): se evitan a propósito.
  const CORRECT = ["Autorizar y registrar el ingreso de personas y vehiculos", "Verdadero"];
  for (let guard = 0; guard < 20; guard++) {
    const options = page.locator(".question-block .option-row");
    await expect(options.first()).toBeVisible({ timeout: 20_000 });
    const count = await options.count();
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const text = (await options.nth(i).innerText()).trim();
      if (!CORRECT.some((c) => text.includes(c))) {
        await options.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await options.first().click();
    }
    const next = page.getByRole("button", { name: "Siguiente" });
    if (await next.isVisible().catch(() => false)) {
      await next.click();
      continue;
    }
    // Sin "Siguiente" => estamos en la última pregunta (queda "Enviar evaluación").
    return;
  }
  throw new Error("El stepper del examen no alcanzó la última pregunta.");
}

// ─── Fase C (Ola 2): cobertura enfocada del gating del guardia ───────────────
// Cada prueba es de lectura sobre el baseline sembrado (reset por global-setup),
// salvo el examen (G-01) y G-06 que ya viven arriba. Capturas en tmp-qa/ola2-c/.
test.describe("guardia · Fase C · gating (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bloqueo secuencial y examen bloqueado visibles en Intramuros (0%)", async ({ page }) => {
    await loginGuardia(page);
    await goToTab(page, "Cursos");
    await expect(page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" })).toBeVisible({
      timeout: 20_000
    });
    // Evidencia del catálogo del guardia (3 cursos reales).
    await page.screenshot({ path: ola2cShot("catalogo.png"), fullPage: true });

    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // (a) Bloqueo SECUENCIAL: la Lección 2 aparece bloqueada (Lock + "Bloqueada")
    // porque la Lección 1 aún no está completa. La primera NO está bloqueada.
    const lockedLesson = page.locator(".lesson-row.locked", {
      hasText: "Video demostrativo: Seguridad Intramuros"
    });
    await expect(lockedLesson).toBeVisible({ timeout: 20_000 });
    await expect(lockedLesson).toContainText("Bloqueada");
    await expect(
      page.locator(".lesson-row.locked", { hasText: "Introduccion a Seguridad Intramuros" })
    ).toHaveCount(0);

    // (b) Examen BLOQUEADO: fila candado + copy de desbloqueo (0% de lecciones).
    const examLocked = page.locator(".quiz-row.exam-locked");
    await expect(examLocked).toBeVisible({ timeout: 20_000 });
    await expect(examLocked).toContainText(
      "Completa todas las lecciones para desbloquear el examen"
    );
    await page.screenshot({ path: ola2cShot("detalle-candados.png"), fullPage: true });
  });

  test("parrilla de diplomas del guardia en Perfil (Ver diploma / Descargar PDF)", async ({ page }) => {
    await loginGuardia(page);
    await goToTab(page, "Perfil");
    await expect(page.getByRole("heading", { name: "Editar perfil" })).toBeVisible({ timeout: 20_000 });

    // (c) Sección de diplomas: al menos el diploma de Proteccion Ejecutiva de Marcos.
    const diplomas = page.locator(".guard-diplomas");
    await expect(diplomas).toBeVisible({ timeout: 20_000 });
    const card = page.locator(".guard-diploma-card", { hasText: "Proteccion Ejecutiva" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Ver diploma" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Descargar PDF" })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: ola2cShot("perfil-diplomas.png"), fullPage: true });
  });

  test("racha visible en Rango (días consecutivos)", async ({ page }) => {
    await loginGuardia(page);
    // El aterrizaje es la tab RANGO; la racha demo de Marcos es 3 días.
    const streak = page.locator(".rank-streak");
    await expect(streak).toBeVisible({ timeout: 20_000 });
    await expect(streak).toContainText("3 días");
    await expect(streak).toContainText("DE RACHA");
    await page.screenshot({ path: ola2cShot("rango-racha.png"), fullPage: true });
  });

  test("la campana abre el panel de novedades", async ({ page }) => {
    await loginGuardia(page);
    // (e) Badge de no-leídos (1 notificación sembrada) + campana clicable.
    const bell = page.locator(".guard-bell");
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".guard-bell-badge")).toBeVisible();

    await bell.click();
    const panel = page.locator(".guard-inbox-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("Novedades");
    await expect(panel).toContainText("Bienvenido a tu carrera del guardia");
    await page.screenshot({ path: ola2cShot("campana-panel.png"), fullPage: true });
  });
});
