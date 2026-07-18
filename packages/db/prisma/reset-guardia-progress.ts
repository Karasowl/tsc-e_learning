/**
 * Restaura al guardia sembrado a su estado base determinista para el QA de la
 * cáscara móvil (carrera del guardia). El seed es idempotente por upsert y NO
 * borra LessonProgress ni eventos del ledger, así que una corrida de e2e que
 * completa lecciones deja XP y porcentajes "pegados". Este script devuelve al
 * guardia al estado sembrado:
 *
 *  - "Seguridad Intramuros": inscrito sin empezar (0%). Es el curso que el QA usa
 *    para probar el +10 XP real una y otra vez.
 *  - "Custodia de Mercancia": en progreso (2 de 3 lecciones = 66.67%). Es el
 *    curso "Continuar tu misión" del hub de Rango.
 *  - XP del ledger a cero: el baseline sembrado son 450 XP (solo eventos "seed").
 *    Cada lección real completada por el QA vuelve a sumar +10 sobre ese baseline.
 *
 * Solo toca datos del guardia; el historial GamiPress ("seed") y otros usuarios
 * quedan intactos. Si la BD no está sembrada, es un no-op tolerante.
 *
 * Correr:  pnpm --filter @tsc-capacita/db run db:reset-guardia
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RESET_AT = new Date("2026-06-08T16:00:00.000Z");

// ---------------------------------------------------------------------------
// Guarda de entorno (misma que el seed): este script BORRA y reescribe datos y
// SOLO debe correr contra la base local de desarrollo. Aborta (sin escribir
// nada) si NODE_ENV es production o si DATABASE_URL apunta a un host que no sea
// local. ALLOW_SEED=1 fuerza la corrida bajo responsabilidad de quien ejecuta.
// ---------------------------------------------------------------------------
function assertLocalResetTarget() {
  if (process.env.ALLOW_SEED === "1") {
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "db:reset-guardia abortado: NODE_ENV=production. El reset solo debe correr contra una base local de desarrollo. Usa ALLOW_SEED=1 para forzarlo bajo tu propia responsabilidad."
    );
  }

  const rawUrl = process.env.DATABASE_URL ?? "";
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(
      "db:reset-guardia abortado: DATABASE_URL ausente o no parseable. El reset solo corre contra una base local (localhost/127.0.0.1). Usa ALLOW_SEED=1 para forzarlo."
    );
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(host)) {
    throw new Error(
      `db:reset-guardia abortado: DATABASE_URL apunta a un host no local (${host}). El reset solo corre contra localhost/127.0.0.1 (base de desarrollo, típicamente :5433). Usa ALLOW_SEED=1 para forzarlo bajo tu propia responsabilidad.`
    );
  }
}

async function courseLessonIds(slug: string): Promise<string[]> {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: { modules: { include: { lessons: { orderBy: { position: "asc" } } } } }
  });
  if (!course) {
    return [];
  }
  return course.modules
    .sort((a, b) => a.position - b.position)
    .flatMap((module) => module.lessons.map((lesson) => lesson.id));
}

async function setEnrollment(userId: string, slug: string, progressPercent: number) {
  const course = await prisma.course.findUnique({ where: { slug } });
  if (!course) {
    return;
  }
  await prisma.enrollment.updateMany({
    where: { userId, courseId: course.id },
    data: { status: "ACTIVE", progressPercent, completedAt: null }
  });
}

async function main() {
  assertLocalResetTarget();

  const guardia = await prisma.user.findUnique({ where: { email: "guardia@tsc.local" } });
  if (!guardia) {
    console.log("[reset-guardia] guardia no encontrado; nada que resetear.");
    return;
  }

  const intramurosLessons = await courseLessonIds("seguridad-intramuros");
  const custodiaLessons = await courseLessonIds("custodia-de-mercancia");

  // 1) XP del ledger a cero: el baseline sembrado (450) son solo eventos "seed".
  const removedXp = await prisma.achievementEvent.deleteMany({
    where: { userId: guardia.id, sourceSystem: "ledger" }
  });

  // 1b) Campana: devuelve las notificaciones del guardia a "sin leer" para que el
  //     badge de novedades y el panel sean reproducibles en cada corrida de e2e
  //     (el spec de la campana marca todo como leido al abrir el panel).
  const resetInbox = await prisma.notification.updateMany({
    where: { userId: guardia.id },
    data: { readAt: null }
  });

  // 2) Intramuros: sin lecciones completadas (0%).
  await prisma.lessonProgress.deleteMany({
    where: { userId: guardia.id, lessonId: { in: intramurosLessons } }
  });
  await setEnrollment(guardia.id, "seguridad-intramuros", 0);

  // 2b) Intramuros: borrar los intentos de examen del guardia para que el examen
  //     (maxAttempts=3) vuelva a estar disponible en cada corrida de e2e. Solo
  //     toca el examen de Intramuros; el intento SELLADO de "Proteccion Ejecutiva"
  //     que verifica el QA del instructor queda intacto. El borrado del intento
  //     arrastra sus QuizAnswer por cascade.
  const removedAttempts = await prisma.quizAttempt.deleteMany({
    where: {
      userId: guardia.id,
      quiz: { course: { slug: "seguridad-intramuros" } }
    }
  });

  // 2c) Intramuros: borrar el diploma que el e2e "aprobar → COMPLETED → reclamar
  //     diploma" emite en cada corrida, y los NotificationLog de ese curso para
  //     el guardia (QUIZ/COURSE_COMPLETED/CERTIFICATE_ISSUED), para que el
  //     reclamo sea repetible y el KPI "Diplomas emitidos" vuelva a su baseline
  //     (1, el diploma sembrado de Proteccion Ejecutiva, que queda intacto).
  let removedCerts = 0;
  const intramurosCourse = await prisma.course.findUnique({ where: { slug: "seguridad-intramuros" } });
  if (intramurosCourse) {
    removedCerts = (
      await prisma.certificate.deleteMany({
        where: { userId: guardia.id, courseId: intramurosCourse.id }
      })
    ).count;
    await prisma.notificationLog.deleteMany({
      where: { userId: guardia.id, courseId: intramurosCourse.id }
    });
  }

  // 3) Custodia: exactamente 2 de 3 lecciones completadas (66.67%), la última sin
  //    completar. Restaura el curso "Continuar tu misión" del hub de Rango.
  if (custodiaLessons.length > 0) {
    const keepCompleted = custodiaLessons.slice(0, 2);
    const clearCompleted = custodiaLessons.slice(2);
    for (const lessonId of keepCompleted) {
      await prisma.lessonProgress.upsert({
        where: { userId_lessonId: { userId: guardia.id, lessonId } },
        update: { completedAt: RESET_AT, lastSeenAt: RESET_AT },
        create: { userId: guardia.id, lessonId, completedAt: RESET_AT, lastSeenAt: RESET_AT }
      });
    }
    if (clearCompleted.length > 0) {
      await prisma.lessonProgress.deleteMany({
        where: { userId: guardia.id, lessonId: { in: clearCompleted } }
      });
    }
    await setEnrollment(guardia.id, "custodia-de-mercancia", 66.67);
  }

  console.log(
    `[reset-guardia] Baseline restaurado: Intramuros 0% (${removedAttempts.count} intento(s) de examen borrados, ${removedCerts} diploma(s) borrados), Custodia 66.67%, ${removedXp.count} evento(s) de XP del ledger borrados (XP → 450), ${resetInbox.count} notificacion(es) marcadas como no leidas.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
