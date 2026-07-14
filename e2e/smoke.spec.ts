import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * QA Fase 0 — skin dark-first del LMS TSC Capacita.
 * Verifica que el tema por defecto es OSCURO, recorre los tres roles sembrados
 * y captura pantallas para revisar el contraste/legibilidad en oscuro.
 *
 * Datos sembrados (password comun): admin@tsc.local / instructor@tsc.local /
 * guardia@tsc.local — password "Capacita2026!". El guardia (Marcos Martinez,
 * STUDENT) tiene 3 cursos: "Proteccion Ejecutiva" (COMPLETED, con diploma),
 * "Custodia de Mercancia" (66%) y "Seguridad Intramuros" (0%).
 */

const API_URL = "http://localhost:4000";
const PASSWORD = "Capacita2026!";
const SHOTS = join(__dirname, "screenshots");

const USERS = {
  admin: "admin@tsc.local",
  instructor: "instructor@tsc.local",
  guardia: "guardia@tsc.local"
} as const;

mkdirSync(SHOTS, { recursive: true });

function shot(name: string) {
  return join(SHOTS, name);
}

// La app hace fetch al API en :4000 apenas se envia el login. Si el API aun
// esta arrancando (pnpm dev levanta api+web en paralelo), esperamos a que
// responda cualquier cosa antes de intentar autenticar.
async function waitForApi(request: APIRequestContext) {
  for (let i = 0; i < 60; i++) {
    try {
      await request.get(`${API_URL}/`, { failOnStatusCode: false, timeout: 4000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`El API en ${API_URL} no respondio a tiempo.`);
}

// Ambos llamadores usan admin@tsc.local, que ahora aterriza en la cáscara de
// marca del Centro de Operaciones (ops-shell), no en el app-shell heredado.
async function login(page: Page, email: string) {
  await waitForApi(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // El Centro de Operaciones reemplaza a la pantalla de login para el admin.
  await expect(page.locator("main.ops-shell")).toBeVisible({ timeout: 30_000 });
}

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return [255, 255, 255];
  }
  const [r, g, b] = match[1].split(",").map((part) => parseFloat(part.trim()));
  return [r, g, b];
}

function isDarkColor(value: string): boolean {
  const [r, g, b] = parseRgb(value);
  // Luminancia perceptual aproximada; el ink-700 (~rgb(18,30,35)) queda muy bajo,
  // el papel claro (~rgb(244,242,236)) queda muy alto.
  return 0.299 * r + 0.587 * g + 0.114 * b < 90;
}

test("login dark-first: el tema por defecto es oscuro", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

  const theme = await page.evaluate(() => ({
    dataTheme: document.documentElement.dataset.theme ?? null,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor
  }));

  // Dark-first: sin preferencia guardada NO debe existir data-theme="light".
  expect(theme.dataTheme, "no debe haber data-theme=light por defecto").not.toBe("light");
  expect(theme.colorScheme, "color-scheme debe ser dark").toContain("dark");
  expect(
    isDarkColor(theme.bodyBg),
    `el fondo del body debe ser oscuro, fue ${theme.bodyBg}`
  ).toBeTruthy();

  await page.screenshot({ path: shot("login.png"), fullPage: true });
});

// El flujo del guardia (estudiante) vive ahora en su cáscara móvil dedicada:
// ver e2e/guardia.spec.ts (rango, tabs, +10 XP real). Aquí quedan el login
// dark-first (rol-agnóstico) y los privilegiados (instructor/admin), que
// conservan su shell de escritorio intacto.

test.describe("privilegiados (desktop 1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("instructor: consola de marca (reemplaza el shell viejo)", async ({ page }) => {
    // El instructor PURO (TEACHER sin ADMIN) ya no usa el app-shell con sidebar:
    // aterriza en la CONSOLA del instructor de marca. El detalle vive en
    // e2e/instructor.spec.ts; aquí solo verificamos el reemplazo del shell.
    await waitForApi(page.request);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    await page.getByLabel("Correo").fill(USERS.instructor);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.locator("main.tconsole-shell")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main.app-shell")).toHaveCount(0);
    await expect(page.locator(".tconsole-wordmark")).toHaveText("CAPACITA");
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: shot("instructor-consola.png"), fullPage: true });
  });

  test("admin: colaboradores + reporte en el Centro de Operaciones", async ({ page }) => {
    await login(page, USERS.admin);
    // Admin aterriza en el Tablero; navegamos por el sidebar de secciones.
    await page.locator(".ops-nav-item", { hasText: "Colaboradores" }).click();
    await expect(page.getByRole("heading", { name: "Colaboradores y roles" })).toBeVisible({
      timeout: 30_000
    });
    // Espera a que la tabla de usuarios tenga filas reales.
    await expect(page.getByRole("row").filter({ hasText: "admin@tsc.local" })).toBeVisible({
      timeout: 20_000
    });
    await page.screenshot({ path: shot("admin-usuarios.png"), fullPage: true });

    // Reporte de colaboradores (reutiliza el reporte real).
    await page.locator(".ops-nav-item", { hasText: "Reportes" }).click();
    await expect(page.getByRole("heading", { name: "Reporte de colaboradores" })).toBeVisible({
      timeout: 20_000
    });
    await page.screenshot({ path: shot("admin-reporte.png"), fullPage: true });
  });
});

test.describe("toggle de tema (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("cambiar a claro (papel) y volver a oscuro", async ({ page }) => {
    await login(page, USERS.admin);
    // Landing del admin: el Tablero del Centro de Operaciones.
    await expect(page.getByRole("heading", { name: "Estado de la plataforma" })).toBeVisible({
      timeout: 30_000
    });

    const toggle = page.getByRole("button", { name: "Cambiar tema" });

    // Estado inicial: oscuro (sin data-theme).
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "dark"))
      .not.toBe("light");

    // A claro.
    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "dark"))
      .toBe("light");
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDarkColor(lightBg), `en claro el body NO debe ser oscuro, fue ${lightBg}`).toBeFalsy();
    await page.screenshot({ path: shot("tema-claro.png"), fullPage: true });

    // De vuelta a oscuro.
    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "dark"))
      .not.toBe("light");
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(isDarkColor(darkBg), `al volver, el body debe ser oscuro, fue ${darkBg}`).toBeTruthy();
  });
});
