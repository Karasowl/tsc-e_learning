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

async function login(page: Page, email: string) {
  await waitForApi(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // El shell logueado reemplaza a la pantalla de login.
  await expect(page.locator("main.app-shell")).toBeVisible({ timeout: 30_000 });
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

test.describe("guardia / estudiante (movil 390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("catalogo, curso completado y perfil sin errores de consola", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    await login(page, USERS.guardia);

    // Panel del estudiante: catalogo con sus cursos inscritos.
    await expect(page.getByRole("button", { name: /Abrir curso/ }).first()).toBeVisible({
      timeout: 30_000
    });
    // Confirma que es el guardia correcto (aparece su nombre en el pill de usuario).
    await expect(page.getByRole("button", { name: /Marcos Martinez/ })).toBeVisible();
    await page.screenshot({ path: shot("guardia-catalogo.png"), fullPage: true });

    // Curso COMPLETED (con diploma): "Proteccion Ejecutiva".
    await page.getByRole("button", { name: "Abrir curso Proteccion Ejecutiva" }).click();
    await expect(page.getByRole("button", { name: /Volver al catálogo/ })).toBeVisible({
      timeout: 20_000
    });
    await expect(
      page.getByRole("heading", { name: "Proteccion Ejecutiva", exact: true })
    ).toBeVisible();
    await page.screenshot({ path: shot("guardia-curso.png"), fullPage: true });

    // Mi perfil (desde el menu de usuario en la topbar).
    await page.getByRole("button", { name: /Marcos Martinez/ }).click();
    await page.getByRole("button", { name: "Mi perfil" }).click();
    await expect(page.getByRole("heading", { name: "Editar perfil" })).toBeVisible({
      timeout: 20_000
    });
    await page.screenshot({ path: shot("guardia-perfil.png"), fullPage: true });

    // No debe haber excepciones JS sin controlar.
    expect(pageErrors, `errores JS sin controlar:\n${pageErrors.join("\n")}`).toEqual([]);

    // Errores de consola de la app (descartando 404 de recursos y terceros/Google).
    const appConsoleErrors = consoleErrors.filter((text) => {
      const t = text.toLowerCase();
      return !(
        t.includes("failed to load resource") ||
        t.includes("favicon") ||
        t.includes("accounts.google") ||
        t.includes("gsi") ||
        t.includes("net::err")
      );
    });
    // eslint-disable-next-line no-console
    console.log("[guardia] console errors (crudos):", JSON.stringify(consoleErrors, null, 2));
    expect.soft(
      appConsoleErrors,
      `errores de consola de la app:\n${appConsoleErrors.join("\n")}`
    ).toEqual([]);
  });
});

test.describe("privilegiados (desktop 1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("instructor: vista de autoria/gestion de cursos", async ({ page }) => {
    await login(page, USERS.instructor);
    // El instructor aterriza en "Gestionar cursos" (autoria).
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({
      timeout: 30_000
    });
    await page.screenshot({ path: shot("instructor-autoria.png"), fullPage: true });
  });

  test("admin: usuarios y roles + reporte", async ({ page }) => {
    await login(page, USERS.admin);
    // Admin aterriza en "Gestionar cursos"; navegamos a Usuarios y roles.
    await page.getByRole("button", { name: "Usuarios y roles" }).click();
    // El topbar (h1) y el panel (h2) comparten el mismo texto; fijamos el h1.
    await expect(page.getByRole("heading", { name: "Usuarios y roles", level: 1 })).toBeVisible({
      timeout: 30_000
    });
    // Espera a que la tabla de usuarios tenga filas reales.
    await expect(page.getByRole("row").filter({ hasText: "admin@tsc.local" })).toBeVisible({
      timeout: 20_000
    });
    await page.screenshot({ path: shot("admin-usuarios.png"), fullPage: true });

    // Reporte de colaboradores (si hay datos).
    await page.getByRole("button", { name: "Reporte" }).click();
    await expect(
      page.getByRole("heading", { name: "Reporte de colaboradores", level: 1 })
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("admin-reporte.png"), fullPage: true });
  });
});

test.describe("toggle de tema (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("cambiar a claro (papel) y volver a oscuro", async ({ page }) => {
    await login(page, USERS.admin);
    // Landing de un privilegiado: el titulo del topbar es "Gestionar cursos"
    // (rol-agnostico; el admin ve "Todos los cursos" como h2, el teacher "Mis cursos").
    await expect(page.getByRole("heading", { name: "Gestionar cursos", level: 1 })).toBeVisible({
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
