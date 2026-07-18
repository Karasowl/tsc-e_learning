import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { establishSession } from "./auth-session";

/**
 * QA del cierre del ciclo del guardia (390x844): aprobar el examen final
 * transita la inscripción a COMPLETED SIN recargar la página, aparece el CTA
 * "Reclamar diploma", el reclamo emite el diploma real (+240 XP) y el diploma
 * aparece en el Perfil.
 *
 * Usa el mismo curso 0% que G-01 ("Seguridad Intramuros"), pero ambos specs
 * restauran el baseline del guardia en su beforeEach (db:reset-guardia:
 * Intramuros 0%, sin intentos ni diploma de Intramuros, XP 450), así que no se
 * pisan aunque corran en serie contra la misma base. El examen tiene
 * maxAttempts=3 y aquí se consume UN intento por corrida, que el reset borra.
 */

// Restaura el baseline sembrado del guardia (ver reset-guardia-progress.ts).
function resetGuardiaBaseline() {
  execSync("pnpm --filter @tsc-capacita/db run db:reset-guardia", { stdio: "ignore" });
}

test.beforeEach(() => {
  resetGuardiaBaseline();
});

async function loginGuardia(page: Page) {
  // Sesión sembrada (storageState) en vez del formulario: no toca /auth/login ni
  // su rate-limit (ver e2e/auth-session.ts).
  await establishSession(page, "guardia");
  await expect(page.locator("main.guard-shell")).toBeVisible({ timeout: 30_000 });
  // El badge dev de Next se solapa con la tabbar en dev; se oculta para capturas.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);
}

// Click por evento para no chocar con el badge dev de Next (igual que guardia.spec).
function goToTab(page: Page, name: "Cursos" | "Logros" | "Rango" | "Perfil") {
  return page.locator(".guard-tabbar").getByRole("button", { name }).dispatchEvent("click");
}

// Completa una lección disponible (no .locked) del curso abierto y espera el
// POST /complete + el refresco del temario.
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

// Respuestas CORRECTAS del examen de Intramuros, tomadas del seed
// (INTRAMUROS_QUESTIONS en packages/db/prisma/seed.ts): la opción correcta de la
// pregunta única y el "Verdadero" del verdadero/falso.
const CORRECT_ANSWERS = [
  "Autorizar y registrar el ingreso de personas y vehiculos",
  "Verdadero"
];

// Recorre el stepper respondiendo cada pregunta con su opción CORRECTA y avanza
// con "Siguiente" hasta la última (donde queda "Enviar evaluación").
async function answerCorrectAndAdvance(page: Page) {
  for (let guard = 0; guard < 20; guard++) {
    const options = page.locator(".question-block .option-row");
    await expect(options.first()).toBeVisible({ timeout: 20_000 });
    const count = await options.count();
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const text = (await options.nth(i).innerText()).trim();
      if (CORRECT_ANSWERS.some((answer) => text.includes(answer))) {
        await options.nth(i).click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      throw new Error("No se encontró la opción correcta de la pregunta actual (¿cambió el seed?).");
    }
    const next = page.getByRole("button", { name: "Siguiente" });
    if (await next.isVisible().catch(() => false)) {
      await next.click();
      continue;
    }
    // Sin "Siguiente" => última pregunta (queda "Enviar evaluación").
    return;
  }
  throw new Error("El stepper del examen no alcanzó la última pregunta.");
}

test.describe("guardia · aprobar → COMPLETED → diploma (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("aprueba el examen final, el curso queda COMPLETED, reclama el diploma y el XP sube", async ({ page }) => {
    await loginGuardia(page);

    // Baseline: XP sembrado del guardia.
    await expect(page.locator(".rank-xp strong")).toHaveText("450");

    // Abrir el curso 0% "Seguridad Intramuros".
    await goToTab(page, "Cursos");
    await page.getByRole("button", { name: "Abrir curso Seguridad Intramuros" }).click();
    await expect(page.locator(".guard-course-detail")).toBeVisible({ timeout: 20_000 });

    // Desbloquear el examen completando las 3 lecciones en orden (+10 XP c/u).
    await completeLessonByTitle(page, "Introduccion a Seguridad Intramuros");
    await completeLessonByTitle(page, "Video demostrativo: Seguridad Intramuros");
    await completeLessonByTitle(page, "Protocolo operativo de Seguridad Intramuros");

    // El examen quedó desbloqueado: abrir el stepper.
    await expect(page.locator(".quiz-row.exam-locked")).toHaveCount(0);
    const examRow = page.locator(".quiz-row", { hasText: "Examen final de Seguridad Intramuros" });
    await expect(examRow).toBeVisible({ timeout: 20_000 });
    await examRow.click();
    await expect(page.locator(".quiz-stepper")).toBeVisible({ timeout: 20_000 });

    // Responder TODO correcto y enviar.
    await answerCorrectAndAdvance(page);
    const submit = page.getByRole("button", { name: "Enviar evaluación" });
    await expect(submit).toBeVisible();
    const submitResp = page.waitForResponse(
      (r) => r.url().includes("/submit") && r.request().method() === "POST"
    );
    await submit.click();
    await submitResp;
    // Dejar asentar el refresco de temario/inscripción/diplomas del submit.
    await page.waitForTimeout(1500);

    // Resultado APROBADO visible y persistente.
    const result = page.locator(".quiz-result.passed");
    await expect(result).toBeVisible();
    await expect(result).toContainText("Aprobado");
    await expect(result).not.toContainText("No aprobado");

    // La inscripción transitó a COMPLETED sin recargar: el avance marca 100% y
    // aparece el CTA "Reclamar diploma" (solo se renderiza con status COMPLETED).
    await expect(page.locator(".guard-course-progress .mono-label")).toHaveText("100%", {
      timeout: 20_000
    });
    const claim = page.getByRole("button", { name: "Reclamar diploma" });
    await expect(claim).toBeVisible({ timeout: 20_000 });

    // Reclamar el diploma: POST /certificates/issue real (201 = emitido nuevo).
    const issueResp = page.waitForResponse(
      (r) => r.url().includes("/certificates/issue") && r.request().method() === "POST"
    );
    await claim.click();
    const issue = await issueResp;
    expect(issue.status()).toBe(201);

    // Confirmaciones en la UI: toast del reclamo y toast del XP del diploma.
    await expect(page.getByText("Diploma reclamado")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("+240 XP", { exact: true })).toBeVisible({ timeout: 15_000 });

    // El CTA cede su lugar a "Ver diploma / Descargar PDF" en el propio curso.
    await expect(page.getByRole("button", { name: "Reclamar diploma" })).toHaveCount(0);
    const detail = page.locator(".guard-course-detail");
    await expect(detail.getByRole("button", { name: "Ver diploma" })).toBeVisible({ timeout: 20_000 });
    await expect(detail.getByRole("button", { name: "Descargar PDF" })).toBeVisible();

    // El diploma aparece en la parrilla del Perfil.
    await goToTab(page, "Perfil");
    const card = page.locator(".guard-diploma-card", { hasText: "Seguridad Intramuros" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("button", { name: "Ver diploma" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Descargar PDF" })).toBeVisible();

    // XP total: 450 base + 30 de lecciones (3 × 10) + 240 del diploma = 720.
    await goToTab(page, "Rango");
    await expect(page.locator(".rank-xp strong")).toHaveText("720", { timeout: 20_000 });
  });
});
