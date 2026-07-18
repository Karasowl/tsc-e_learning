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

// Evidencia de la Fase D (Ola 2) para el reporte de QA. Vive en el repo (tmp-qa/).
const D_SHOTS = join(process.cwd(), "tmp-qa", "ola2-d");
mkdirSync(D_SHOTS, { recursive: true });

function shot(name: string) {
  return join(QA_SHOTS, name);
}

function dshot(name: string) {
  return join(D_SHOTS, name);
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
  // El endpoint /auth/login limita a 10 logins/min por IP (rate-limit real del
  // producto). Al correr TODA la suite, admin(2)+guardia(8) llenan esa ventana y
  // el primer login del instructor (el #11) puede recibir 429, que la UI muestra
  // como "Credenciales invalidas". Reintentamos con una espera corta: al pasar los
  // segundos los logins viejos salen de la ventana deslizante y se libera cupo.
  // Esto NO toca el rate-limit del producto; solo hace robusto el e2e en su contra.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    await page.getByLabel("Correo").fill(INSTRUCTOR);
    await page.getByLabel("Contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    // La consola del instructor reemplaza al login (NO es el app-shell de escritorio).
    try {
      await page
        .locator("main.tconsole-shell")
        .waitFor({ state: "visible", timeout: attempt === MAX_ATTEMPTS ? 30_000 : 8_000 });
      return;
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error("La consola del instructor no cargó tras reintentar el login (¿rate-limit persistente?).");
      }
      // Login rechazado (probable 429): espera a que se libere cupo y reintenta.
      await page.waitForTimeout(12_000);
    }
  }
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

    // Estructura (default) monta el builder de 2 paneles (Ola 2) dentro del shell.
    await expect(page.getByRole("heading", { name: "Contenido del curso" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".editor-2pane")).toBeVisible();
    await expect(
      page.locator(".editor-pane--tree").getByRole("heading", { name: "Contenido del curso" })
    ).toBeVisible();
    await expect(
      page.locator(".editor-pane--detail").getByRole("heading", { name: "Detalles del curso" })
    ).toBeVisible();
    await page.screenshot({ path: shot("02-estructura.png"), fullPage: true });
    await page.screenshot({ path: dshot("builder-2paneles.png"), fullPage: true });

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

    // Vista previa: temario como lo ve un colaborador, con marco móvil (Ola 2).
    await page.locator(".tconsole-tab", { hasText: "Vista previa" }).click();
    await expect(page.locator(".tconsole-preview-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tconsole-preview-module").first()).toBeVisible();
    await expect(page.locator(".tpreview-phone")).toBeVisible();
    await page.locator(".tpreview-phone").screenshot({ path: dshot("vista-previa-movil.png") });

    // Anuncios: compositor real (Ola 2), ya no el placeholder "En construcción".
    await page.locator(".tconsole-tab", { hasText: "Anuncios" }).click();
    await expect(page.getByRole("heading", { name: "Anuncios del curso" })).toBeVisible();
    await expect(page.locator(".tconsole-anuncio-form")).toBeVisible();
    await expect(page.locator(".tconsole-anuncio-form").getByRole("button", { name: "Publicar" })).toBeVisible();
    await expect(page.locator(".tconsole-soon")).toHaveCount(0);

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

    // Crear un curso temporal con el asistente Nuevo curso (nace Borrador v1).
    const title = `QA Publicar ${Date.now()}`;
    await page.getByRole("button", { name: "Nuevo curso" }).click();
    await page.getByLabel("Título del curso").fill(title);
    await page.getByRole("button", { name: "Siguiente" }).click(); // Datos base -> Línea de servicio
    await page.getByRole("button", { name: "Siguiente" }).click(); // Línea de servicio -> Estructura
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

/**
 * Cobertura enfocada de la FASE D (Ola 2) de la consola del instructor:
 *  - Anuncios: el compositor real publica un aviso que aparece en la lista.
 *  - Ajustes: agregar y quitar un prerrequisito entre dos cursos del instructor.
 *  - Asistente Nuevo curso: 3 pasos, crea con línea de servicio, lista y borra.
 *  - Builder de 2 paneles: el reorden de secciones persiste (no rompió con el rediseño).
 * El diseñador de certificados es admin-only y NO se ejercita con el instructor.
 */
test.describe("instructor · Fase D Ola 2 (1280x800)", () => {
  // Los 4 casos comparten UNA sola sesión (un único login) y corren en serie: así
  // no se suman 4 logins más al pico de la suite y no se cruza el límite de
  // 10 logins/min del endpoint /auth/login (rate-limit real del producto).
  test.describe.configure({ mode: "serial" });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await loginInstructor(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Vuelve a "Mis cursos" sin re-login: usa el breadcrumb si hay un curso abierto.
  async function goToList() {
    const backLink = page.locator(".tconsole-crumb.is-link", { hasText: "Mis cursos" });
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
    }
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({ timeout: 20_000 });
  }

  async function openCourseCard(title: string) {
    await goToList();
    await page.locator(".tconsole-card", { hasText: title }).click();
    await expect(page.locator(".tconsole-crumb.is-current").last()).toHaveText(title);
  }

  test("Anuncios: el compositor publica un aviso y aparece en la lista", async () => {
    await openCourseCard("Proteccion Ejecutiva");

    await page.locator(".tconsole-tab", { hasText: "Anuncios" }).click();
    await expect(page.getByRole("heading", { name: "Anuncios del curso" })).toBeVisible();

    const annTitle = `Simulacro nocturno ${Date.now()}`;
    const form = page.locator(".tconsole-anuncio-form");
    await form.getByLabel("Título").fill(annTitle);
    await form.getByLabel("Mensaje").fill("Repaso del protocolo operativo este viernes a las 18:00.");
    await form.getByRole("button", { name: "Publicar" }).click();

    const item = page.locator(".tconsole-anuncio", { hasText: annTitle });
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toContainText("Repaso del protocolo operativo");
    await page.screenshot({ path: dshot("anuncios-compositor.png"), fullPage: true });

    // Limpieza: borrar el aviso para no acumular ruido entre corridas.
    await item.getByRole("button", { name: "Eliminar anuncio" }).click();
    await page.locator(".confirm-panel").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.locator(".tconsole-anuncio", { hasText: annTitle })).toHaveCount(0);
  });

  test("Ajustes: agrega y quita un prerrequisito entre dos cursos del instructor", async () => {
    // "Custodia de Mercancia" ya requiere "Proteccion Ejecutiva" (seed). Añadimos
    // "Seguridad Intramuros" como segundo prerrequisito (acíclico) y luego lo quitamos.
    await openCourseCard("Custodia de Mercancia");
    await page.locator(".tconsole-tab", { hasText: "Ajustes" }).click();

    const block = page.locator(".tconsole-settings-block", { hasText: "Prerrequisitos" });
    await expect(block.getByRole("heading", { name: "Prerrequisitos" })).toBeVisible();

    // Estado base determinista: si un run previo dejó Intramuros, quítalo primero.
    const residual = block.locator(".tconsole-req-chip", { hasText: "Seguridad Intramuros" });
    if ((await residual.count()) > 0) {
      await residual.getByRole("button", { name: /Quitar/ }).click();
      await expect(block.locator(".tconsole-req-chip", { hasText: "Seguridad Intramuros" })).toHaveCount(0);
    }

    await block.getByLabel("Curso prerrequisito").selectOption({ label: "Seguridad Intramuros" });
    await block.getByRole("button", { name: "Agregar" }).click();
    const chip = block.locator(".tconsole-req-chip", { hasText: "Seguridad Intramuros" });
    await expect(chip).toBeVisible({ timeout: 20_000 });

    // La captura de Ajustes muestra el prerrequisito + el bloque Certificado del curso.
    await expect(page.getByRole("heading", { name: "Certificado del curso" })).toBeVisible();
    await page.screenshot({ path: dshot("ajustes-prereq-certificado.png"), fullPage: true });

    // Quitar el prerrequisito y verificar que el chip desaparece.
    await chip.getByRole("button", { name: "Quitar Seguridad Intramuros" }).click();
    await expect(block.locator(".tconsole-req-chip", { hasText: "Seguridad Intramuros" })).toHaveCount(0);
  });

  test("Asistente Nuevo curso: crea con línea de servicio, lista y borra (3 pasos)", async () => {
    await goToList();
    const title = `QA Asistente ${Date.now()}`;

    await page.getByRole("button", { name: "Nuevo curso" }).click();

    // Paso 1: Datos base (título + nivel).
    await expect(page.locator(".wizard-step.is-active")).toContainText("Datos base");
    await page.getByLabel("Título del curso").fill(title);
    await page.locator(".wizard-chip", { hasText: "Intermedio" }).click();
    await page.screenshot({ path: dshot("asistente-1-datos.png") });
    await page.getByRole("button", { name: "Siguiente" }).click();

    // Paso 2: Línea de servicio.
    await expect(page.locator(".wizard-step.is-active")).toContainText("Línea de servicio");
    await page.locator(".wizard-chip", { hasText: "Custodia de mercancía" }).click();
    await page.screenshot({ path: dshot("asistente-2-linea.png") });
    await page.getByRole("button", { name: "Siguiente" }).click();

    // Paso 3: Estructura (plantilla).
    await expect(page.locator(".wizard-step.is-active")).toContainText("Estructura");
    await page.locator(".wizard-template-card", { hasText: "En blanco" }).click();
    await page.screenshot({ path: dshot("asistente-3-estructura.png") });
    await page.getByRole("button", { name: "Crear curso" }).click();

    // Aterriza en la Estructura del curso nuevo (Borrador v1); la línea de servicio
    // quedó guardada como primera línea de la descripción.
    await expect(page.locator(".tconsole-topbar-actions")).toContainText("Borrador", { timeout: 20_000 });
    await expect(page.locator(".editor-pane--detail").getByLabel("Descripción")).toHaveValue(
      /Línea de servicio: Custodia de mercancía/
    );

    // Vuelve a la lista: el curso nuevo aparece.
    await page.locator(".tconsole-crumb.is-link", { hasText: "Mis cursos" }).click();
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tconsole-card", { hasText: title })).toBeVisible();

    // Limpieza: abrir y borrar desde Ajustes para no contaminar la lista.
    await page.locator(".tconsole-card", { hasText: title }).click();
    await page.locator(".tconsole-tab", { hasText: "Ajustes" }).click();
    await page.getByRole("button", { name: "Eliminar curso" }).click();
    await page.locator(".confirm-panel").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByRole("heading", { name: "Mis cursos" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tconsole-card", { hasText: title })).toHaveCount(0);
  });

  test("Builder de 2 paneles: reordenar una sección persiste y se puede restaurar", async () => {
    await openCourseCard("Proteccion Ejecutiva");

    // Estructura por defecto: el árbol lista las secciones en orden del seed.
    await expect(page.locator(".editor-2pane")).toBeVisible({ timeout: 20_000 });
    const titles = page.locator(".editor-pane--tree .module-edit-head strong");
    await expect(titles.first()).toHaveText("Fundamentos");
    await expect(titles.nth(1)).toHaveText("Practica y evaluacion");

    // Bajar "Fundamentos": el backend renumera y el árbol recarga en el nuevo orden.
    await page
      .locator(".module-edit", { hasText: "Fundamentos" })
      .getByRole("button", { name: "Bajar sección" })
      .click();
    await expect(titles.first()).toHaveText("Practica y evaluacion", { timeout: 20_000 });
    await expect(titles.nth(1)).toHaveText("Fundamentos");

    // Restaurar para dejar el seed intacto: subir "Fundamentos".
    await page
      .locator(".module-edit", { hasText: "Fundamentos" })
      .getByRole("button", { name: "Subir sección" })
      .click();
    await expect(titles.first()).toHaveText("Fundamentos", { timeout: 20_000 });
    await expect(titles.nth(1)).toHaveText("Practica y evaluacion");
  });
});
