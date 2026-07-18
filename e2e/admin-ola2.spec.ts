import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * QA de la OLA 2 · Fase E (Centro de Operaciones admin, rol ADMIN) — desktop 1280x800.
 * Verifica contra la build real y datos reales (sin mocks) las superficies nuevas:
 *  (a) Tablero de gobierno: tarjeta de alerta + barras de cumplimiento + bitácora 24 h.
 *  (b) Expediente del colaborador (abre desde Colaboradores).
 *  (c) Padrón maestro: filtra por estado "Vencido" y muestra la inscripción vencida
 *      sembrada (Rosa Delgado, pill "Vencido") + la barra de acciones masivas.
 *  (d) Campana in-app (bandeja de notificaciones) abre su panel.
 *  (e) Anuncios: publica un anuncio GLOBAL y aparece en la lista.
 *  (f) Diseñador de plantilla de diploma (abre el modal, sin subir archivos).
 *
 * Un solo login por archivo (modo serial + página compartida) para no presionar el
 * rate-limit de /auth/login (máx. 10/min). El login reintenta con espera por si la
 * ventana de rate-limit se satura durante la corrida completa.
 *
 * Datos sembrados relevantes (password común "Capacita2026!"): admin@tsc.local;
 * Rosa Delgado (demo.vencido@tsc.local) con 1 inscripción VENCIDA en Custodia de
 * Mercancía; evento de bitácora demo dentro de las últimas 24 h.
 */

const API_URL = "http://localhost:4000";
const PASSWORD = "Capacita2026!";
const ADMIN = "admin@tsc.local";
const QA_SHOTS = join(process.cwd(), "tmp-qa", "ola2-e");

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

async function loginAdmin(page: Page) {
  await waitForApi(page.request);
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Correo").fill(ADMIN);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    try {
      // El Centro de Operaciones reemplaza al login (NO es el app-shell viejo).
      await page
        .locator("main.ops-shell")
        .waitFor({ state: "visible", timeout: attempt === MAX_ATTEMPTS ? 30_000 : 8_000 });
      return;
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error("No se pudo iniciar sesión como admin (¿rate-limit de /auth/login?).");
      }
      // Probable 429 por rate-limit (máx. 10/min). Espera a que la ventana se libere.
      await page.waitForTimeout(12_000);
    }
  }
}

async function goTo(page: Page, navLabel: string) {
  await page.locator(".ops-nav-item", { hasText: navLabel }).click();
}

test.describe("admin ola2 · centro de operaciones (1280x800)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 } });

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await loginAdmin(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("(a) tablero de gobierno: alerta + cumplimiento + bitácora", async () => {
    await goTo(page, "Tablero");
    await expect(page.getByRole("heading", { name: "Estado de la plataforma" })).toBeVisible({ timeout: 20_000 });

    // Tarjeta de alerta de gobierno (la señal más severa vigente). Siempre hay al
    // menos una en la base demo; su tipo depende del estado operativo real.
    await expect(page.locator(".ops-alert")).toBeVisible({ timeout: 20_000 });

    // Cumplimiento: al menos una barra por línea/sede (Custodia de mercancía suma la
    // inscripción vencida de Rosa como 0/2 sin completar).
    await expect(page.locator(".ops-compliance").first()).toBeVisible();
    await expect(page.locator(".ops-bar").first()).toBeVisible();
    expect(await page.locator(".ops-bar").count()).toBeGreaterThan(0);

    // Bitácora de las últimas 24 h (el evento demo sembrado la deja poblada).
    await expect(page.locator(".ops-bitacora")).toBeVisible();
    await expect(page.locator(".ops-audit-item").first()).toBeVisible();

    await page.screenshot({ path: shot("01-tablero-gobierno.png"), fullPage: true });
  });

  test("(b) abre el expediente de un colaborador", async () => {
    await goTo(page, "Colaboradores");
    await expect(page.getByRole("heading", { name: "Colaboradores y roles" })).toBeVisible({ timeout: 20_000 });

    // Nombre clicable del roster => modal "Expediente del colaborador".
    await page.locator(".users-admin .linklike-name").first().click();
    const dossier = page.getByRole("dialog", { name: "Expediente del colaborador" });
    await expect(dossier).toBeVisible({ timeout: 20_000 });
    // El expediente carga datos reales (hero con rango/XP del colaborador).
    await expect(dossier.locator(".dossier-hero")).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: shot("02-expediente.png"), fullPage: true });

    // Cierra el modal para no dejar el diálogo abierto en el siguiente test.
    await dossier.getByRole("button", { name: "Cerrar" }).click();
    await expect(dossier).toBeHidden();
  });

  test("(c) padrón maestro: filtra Vencido y muestra la inscripción vencida", async () => {
    await goTo(page, "Inscripciones");
    // Vista por defecto: padrón maestro (tabs segmentadas).
    await expect(page.locator(".ops-segmented")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Padrón maestro" })).toBeVisible();

    // Filtra por estado "Vencido" (value EXPIRED) usando el select que contiene esa opción.
    const statusSelect = page
      .locator(".ops-master-filters select")
      .filter({ has: page.locator('option[value="EXPIRED"]') });
    await statusSelect.selectOption("EXPIRED");

    // La inscripción vencida sembrada (Rosa Delgado) aparece con la pill "Vencido".
    const vencidoRow = page.locator(".ops-master-table tbody tr", { hasText: "Rosa Delgado" });
    await expect(vencidoRow).toBeVisible({ timeout: 20_000 });
    await expect(vencidoRow.locator(".status-pill.vencido")).toHaveText("Vencido");

    // Seleccionar la fila muestra la barra de acciones masivas (sin ejecutar mutación).
    await vencidoRow.locator('input[type="checkbox"]').check();
    await expect(page.locator(".ops-bulk-bar")).toBeVisible();
    await expect(page.locator(".ops-bulk-bar")).toContainText("seleccionada");

    await page.screenshot({ path: shot("03-padron-vencido.png"), fullPage: true });

    // Deselecciona para no arrastrar estado al siguiente test.
    await vencidoRow.locator('input[type="checkbox"]').uncheck();
  });

  test("(d) la campana abre el panel de novedades", async () => {
    // La campana in-app vive en la topbar (distinta del botón "Correos automáticos").
    const bell = page.locator(".ops-inbox-trigger");
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.locator(".ops-inbox-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText("Notificaciones");

    await page.screenshot({ path: shot("04-campana.png"), fullPage: true });

    // Cierra el panel (backdrop) para dejar la topbar limpia.
    await page.locator(".menu-backdrop").first().click();
    await expect(panel).toBeHidden();
  });

  test("(e) publica un anuncio global", async () => {
    await goTo(page, "Anuncios");
    await expect(page.locator(".ops-announcements")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Anuncios de la plataforma" })).toBeVisible();

    const stamp = Date.now();
    const title = `Simulacro de gobierno ${stamp}`;
    const body = "Aviso global de prueba: verifica tus inscripciones vigentes con tu supervisor.";

    const form = page.locator(".ops-announcements form.tconsole-anuncio-form");
    await form.locator("input").fill(title);
    await form.locator("textarea").fill(body);
    await form.getByRole("button", { name: "Publicar anuncio" }).click();

    // El anuncio recién publicado aparece en la lista (scope GLOBAL).
    await expect(page.locator(".tconsole-anuncio", { hasText: title })).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: shot("05-anuncio-global.png"), fullPage: true });
  });

  test("(f) diseñador de plantilla de diploma abre su modal", async () => {
    await goTo(page, "Diplomas");
    await expect(page.locator(".ops-cert-templates")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Plantillas de diploma" })).toBeVisible();

    await page.getByRole("button", { name: "Diseñar plantilla" }).click();
    const designer = page.getByRole("dialog", { name: "Nueva plantilla de diploma" });
    await expect(designer).toBeVisible({ timeout: 20_000 });
    // Diseñador con vista previa en vivo (sin subir archivos reales).
    await expect(designer.locator(".cert-designer")).toBeVisible();
    await expect(designer.locator(".cert-preview")).toBeVisible();

    await page.screenshot({ path: shot("06-cert-designer.png"), fullPage: true });

    // Cierra sin guardar.
    await designer.getByRole("button", { name: "Cerrar" }).click();
    await expect(designer).toBeHidden();
  });
});
