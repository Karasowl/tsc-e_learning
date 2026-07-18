import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { establishSession } from "./auth-session";

/**
 * QA del CENTRO DE OPERACIONES (rol ADMIN) — desktop 1280x800.
 * Verifica contra la build real y datos reales (sin mocks):
 *  - Login admin -> aterriza en la cáscara de marca "ops-shell" (NO el app-shell viejo).
 *  - Topbar de marca: ancla CAPACITA + reloj + indicador EN VIVO.
 *  - Tablero con KPIs REALES (Cursos publicados = 3 sembrados) + actividad reciente real.
 *  - Navegación del shell por secciones (Colaboradores, Reportes).
 *  - Invitación REAL: crea un colaborador INVITED con enlace de activación, y lo
 *    activa por token de punta a punta (queda ACTIVE y entra a su cáscara).
 *
 * Datos sembrados (password comun "Capacita2026!"): admin@tsc.local; 3 cursos
 * PUBLICADOS; el guardia Marcos Martinez con 1 curso completado + 1 diploma.
 */

const QA_SHOTS =
  "/tmp/claude-1000/-home-karasowl-dev-tsc-e-learning/64f53584-2202-4228-a0bd-dd9736a5f90c/scratchpad/qa-admin";

mkdirSync(QA_SHOTS, { recursive: true });

function shot(name: string) {
  return join(QA_SHOTS, name);
}

async function loginAdmin(page: Page) {
  // Sesión sembrada (storageState) en vez del formulario: no toca /auth/login ni su
  // rate-limit (ver e2e/auth-session.ts). El assert de la cáscara no cambia.
  await establishSession(page, "admin");
  // El Centro de Operaciones reemplaza al login (NO es el app-shell viejo).
  await expect(page.locator("main.ops-shell")).toBeVisible({ timeout: 30_000 });
}

test.describe("admin · centro de operaciones (1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("tablero de marca con KPIs reales + navegación del shell", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

    await loginAdmin(page);

    // Marca (ancla CAPACITA) + topbar EN VIVO, sin el app-shell heredado.
    await expect(page.locator(".ops-wordmark").first()).toHaveText("CAPACITA");
    await expect(page.locator("main.app-shell")).toHaveCount(0);
    await expect(page.locator(".ops-live")).toContainText("EN VIVO");
    await expect(page.locator(".ops-clock-time")).toBeVisible();

    // Tablero: 4 tarjetas KPI reales. "Cursos publicados" = 3 (cursos sembrados).
    await expect(page.getByRole("heading", { name: "Estado de la plataforma" })).toBeVisible();
    await expect(page.locator(".ops-kpi")).toHaveCount(4, { timeout: 20_000 });
    const publishedCard = page.locator(".ops-kpi", { hasText: "Cursos publicados" });
    await expect(publishedCard).toContainText("3");
    const diplomasCard = page.locator(".ops-kpi", { hasText: "Diplomas emitidos" });
    await expect(diplomasCard).toContainText("1");

    // Actividad reciente real (el diploma sembrado de Marcos Martinez).
    await expect(page.locator(".ops-activity")).toContainText("Marcos Martinez");
    await page.screenshot({ path: shot("01-tablero.png"), fullPage: true });

    // Navegar a Reportes (reutiliza el reporte real /reports/students).
    await page.locator(".ops-nav-item", { hasText: "Reportes" }).click();
    await expect(page.getByRole("heading", { name: "Reporte de colaboradores" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".metrics-row")).toBeVisible();
    await page.screenshot({ path: shot("04-reportes.png"), fullPage: true });

    // Navegar a Colaboradores.
    await page.locator(".ops-nav-item", { hasText: "Colaboradores" }).click();
    await expect(page.getByRole("heading", { name: "Colaboradores y roles" })).toBeVisible({ timeout: 20_000 });
    // El admin sembrado aparece en el roster.
    await expect(page.locator(".users-admin tbody")).toContainText("admin@tsc.local");
    await page.screenshot({ path: shot("02-colaboradores.png"), fullPage: true });

    expect(pageErrors, `errores JS sin controlar:\n${pageErrors.join("\n")}`).toEqual([]);
  });

  test("invita a un colaborador real (INVITED) y lo activa por token", async ({ page }) => {
    await loginAdmin(page);

    // Ir a Colaboradores y abrir el flujo de invitación.
    await page.locator(".ops-nav-item", { hasText: "Colaboradores" }).click();
    await expect(page.getByRole("heading", { name: "Colaboradores y roles" })).toBeVisible({ timeout: 20_000 });

    // Email FIJO: el roster no crece corrida tras corrida. El global-setup borra
    // la cuenta QA de la corrida anterior (que quedó ACTIVE al activarse), así
    // esta invitación siempre parte de cero y el flujo es repetible.
    const email = "qa.invite@tsc.local";
    const name = "QA Invitado";

    await page.getByRole("button", { name: "Invitar" }).click();
    const inviteForm = page.locator("form.invite-form");
    await expect(inviteForm).toBeVisible();
    await inviteForm.getByLabel("Nombre").fill(name);
    await inviteForm.getByLabel("Correo").fill(email);
    await inviteForm.getByRole("button", { name: "Enviar invitación" }).click();

    // En dev (sin envío real) aparece el panel con el enlace de activación.
    const linkPanel = page.locator(".invite-link-panel");
    await expect(linkPanel).toBeVisible({ timeout: 20_000 });
    await expect(linkPanel).toContainText("Enlace de activación");
    const activationUrl = await page.locator(".invite-link-row input").inputValue();
    expect(activationUrl).toContain("/activar/");

    // El colaborador aparece en el roster con el estado INVITED real.
    const invitedRow = page.locator(".users-admin tbody tr", { hasText: name });
    await expect(invitedRow).toBeVisible({ timeout: 20_000 });
    await expect(invitedRow.locator(".status-pill.invited")).toHaveText("Invitado");
    await page.screenshot({ path: shot("03-invitar.png"), fullPage: true });

    // Activar por token de punta a punta: fijar contraseña -> queda ACTIVE y entra.
    await page.goto(activationUrl);
    await expect(page.locator(".activate-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".activate-greeting")).toContainText(name);
    await page.getByLabel("Contraseña", { exact: true }).fill("ClaveNueva2026");
    await page.getByLabel("Confirmar contraseña").fill("ClaveNueva2026");
    await page.getByRole("button", { name: "Activar mi cuenta" }).click();

    // Tras activar, el colaborador (STUDENT puro) aterriza en su cáscara de guardia.
    await expect(page.locator("main.guard-shell")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: shot("05-activado.png"), fullPage: true });
  });
});
