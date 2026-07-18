import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { establishSession, ROLE_EMAIL, type Role } from "./auth-session";

/**
 * Evidencia visual de la Ola 1 (para QA humano). NO es una prueba funcional
 * exhaustiva: recorre las superficies arregladas por la Ola 1 y guarda capturas
 * en tmp-qa/ola1/. Todo es de solo lectura (no muta datos sembrados), así que no
 * contamina el baseline del que dependen guardia.spec.ts / instructor.spec.ts.
 *
 *  - guardia: acceso al diploma ya emitido (Ver diploma / Descargar PDF).
 *  - instructor: reordenar secciones/clases con flechas + tablero de Resultados.
 *  - admin: topbar "EN VIVO" + sección "Correos automáticos".
 */

const OLA1_SHOTS = join(__dirname, "..", "tmp-qa", "ola1");

mkdirSync(OLA1_SHOTS, { recursive: true });

function ola1Shot(name: string) {
  return join(OLA1_SHOTS, name);
}

async function login(page: Page, email: string, shell: string) {
  // Sesión sembrada (storageState) en vez del formulario: no toca /auth/login ni su
  // rate-limit (ver e2e/auth-session.ts). El assert de la cáscara no cambia.
  const role: Role =
    email === ROLE_EMAIL.admin ? "admin" : email === ROLE_EMAIL.instructor ? "instructor" : "guardia";
  await establishSession(page, role);
  await expect(page.locator(shell)).toBeVisible({ timeout: 30_000 });
}

test.describe("evidencia ola 1 · guardia (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("acceso al diploma emitido: Ver diploma + Descargar PDF", async ({ page }) => {
    await login(page, "guardia@tsc.local", "main.guard-shell");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);

    // Abrir el curso COMPLETADO con diploma sembrado (Proteccion Ejecutiva).
    await page.locator(".guard-tabbar").getByRole("button", { name: "Cursos" }).dispatchEvent("click");
    await page.getByRole("button", { name: "Abrir curso Proteccion Ejecutiva" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // El CTA del diploma ya no dice "Reclamar": abre y descarga el diploma existente.
    await expect(page.getByRole("button", { name: "Ver diploma" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeVisible();
    await page.screenshot({ path: ola1Shot("guardia-diploma-ver-descargar.png"), fullPage: true });
  });
});

test.describe("evidencia ola 1 · instructor (1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("reordenar con flechas + tablero de Resultados", async ({ page }) => {
    await login(page, "instructor@tsc.local", "main.tconsole-shell");

    // Abrir un curso: Estructura (default) monta la autoría con las flechas de orden.
    await page.locator(".tconsole-card", { hasText: "Proteccion Ejecutiva" }).click();
    await expect(page.getByRole("heading", { name: "Contenido del curso" })).toBeVisible({ timeout: 20_000 });
    // Flechas de reordenamiento de secciones y clases (Subir/Bajar).
    await expect(page.getByRole("button", { name: "Bajar sección" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Subir clase" }).first()).toBeVisible();
    await page.screenshot({ path: ola1Shot("instructor-reorden-flechas.png"), fullPage: true });

    // Resultados: el intento sembrado, sellado y aprobado.
    await page.locator(".tconsole-tab", { hasText: "Resultados" }).click();
    const sealedRow = page.locator(".tconsole-report tbody tr", { hasText: "Marcos Martinez" });
    await expect(sealedRow).toBeVisible({ timeout: 20_000 });
    await expect(sealedRow).toContainText("Aprobado");
    await expect(sealedRow).toContainText("sellado");
    await page.screenshot({ path: ola1Shot("instructor-resultados.png"), fullPage: true });
  });
});

test.describe("evidencia ola 1 · admin (1280x800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("topbar EN VIVO + sección Correos automáticos", async ({ page }) => {
    await login(page, "admin@tsc.local", "main.ops-shell");

    // Indicador "EN VIVO" real en la topbar del Centro de Operaciones.
    await expect(page.locator(".ops-live")).toContainText("EN VIVO");
    await expect(page.getByRole("heading", { name: "Estado de la plataforma" })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: ola1Shot("admin-en-vivo.png"), fullPage: true });

    // Sección "Correos automáticos" (antes "Notificaciones").
    await page.locator(".ops-nav-item", { hasText: "Correos automáticos" }).click();
    await expect(page.locator(".ops-title")).toHaveText("Correos automáticos");
    await page.screenshot({ path: ola1Shot("admin-correos-automaticos.png"), fullPage: true });
  });
});
