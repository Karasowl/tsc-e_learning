import type { Prisma, PrismaClient } from "@prisma/client";
import { emitStudentNotification } from "./notifications.js";
import { awardCourseCompletionBadges } from "./gamification.js";

export type CourseProgressResult = {
  progressPercent: number | null;
  completedAt: Date | null;
  newlyCompleted: boolean;
};

/**
 * Recalcula el avance del curso para un usuario y, si corresponde, marca la
 * inscripción como COMPLETED. Un curso solo se completa cuando TODAS sus
 * lecciones están hechas Y cada examen PUBLICADO tiene un intento aprobado; los
 * cursos sin examen publicado se completan solo con las lecciones.
 *
 * Nunca borra una finalización previa ni degrada el status (protege las
 * inscripciones COMPLETED migradas de WordPress). `client` es inyectable para
 * poder probar sin base de datos.
 */
export async function updateCourseProgress(
  client: PrismaClient,
  userId: string,
  courseId: string
): Promise<CourseProgressResult> {
  const [totalLessons, completedLessons] = await Promise.all([
    client.lesson.count({ where: { courseId } }),
    client.lessonProgress.count({
      where: {
        userId,
        lesson: { courseId },
        completedAt: { not: null }
      }
    })
  ]);

  const progressPercent = totalLessons > 0 ? Number(((completedLessons / totalLessons) * 100).toFixed(2)) : 0;
  const lessonsDone = totalLessons > 0 && completedLessons >= totalLessons;

  let quizzesPassed = true;
  if (lessonsDone) {
    const quizzes = await client.quiz.findMany({
      where: { courseId, status: "PUBLISHED" },
      select: { id: true }
    });
    if (quizzes.length > 0) {
      const quizIds = quizzes.map((quiz) => quiz.id);
      const passed = await client.quizAttempt.findMany({
        where: { userId, status: "PASSED", quizId: { in: quizIds } },
        select: { quizId: true },
        distinct: ["quizId"]
      });
      quizzesPassed = passed.length >= quizIds.length;
    }
  }
  const requirementsMet = lessonsDone && quizzesPassed;

  const enrollment = await client.enrollment.findUnique({
    where: {
      userId_courseId: {
        userId,
        courseId
      }
    }
  });

  if (!enrollment) {
    return {
      progressPercent,
      completedAt: null,
      newlyCompleted: false
    };
  }

  const newlyCompleted = Boolean(requirementsMet && enrollment.status !== "COMPLETED");

  const updated = await client.enrollment.update({
    where: {
      userId_courseId: {
        userId,
        courseId
      }
    },
    data: {
      progressPercent,
      // Never wipe an existing completion nor downgrade status (protects the
      // already-completed enrollments migrated from WordPress).
      completedAt: requirementsMet ? enrollment.completedAt ?? new Date() : enrollment.completedAt,
      status: requirementsMet ? "COMPLETED" : enrollment.status
    }
  });

  return {
    progressPercent: decimalToNumber(updated.progressPercent),
    completedAt: updated.completedAt,
    newlyCompleted
  };
}

/**
 * Recalcula la finalización del curso y, SOLO cuando la inscripción acaba de
 * transicionar a COMPLETED, dispara los efectos de finalización con exactamente
 * la misma composición que la ruta de completar lección: notificación
 * COURSE_COMPLETED e insignias de cursos completados. Idempotente: un curso ya
 * COMPLETED no vuelve a disparar nada.
 */
export async function recomputeCourseCompletion(
  client: PrismaClient,
  opts: { userId: string; courseId: string; courseTitle: string; completedAt?: Date | undefined }
): Promise<CourseProgressResult> {
  const courseProgress = await updateCourseProgress(client, opts.userId, opts.courseId);

  if (courseProgress.newlyCompleted) {
    await emitStudentNotification(
      {
        eventType: "COURSE_COMPLETED",
        userId: opts.userId,
        courseId: opts.courseId,
        payload: { courseTitle: opts.courseTitle }
      },
      client
    );
    const completedCourses = await client.enrollment.count({
      where: { userId: opts.userId, status: "COMPLETED" }
    });
    await awardCourseCompletionBadges(client, {
      userId: opts.userId,
      courseId: opts.courseId,
      completedCourses,
      awardedAt: opts.completedAt
    });
  }

  return courseProgress;
}

/**
 * Recalcula la finalización para TODAS las inscripciones de un curso que ya
 * tienen las lecciones al 100% y siguen ACTIVE. Se usa cuando el docente borra
 * o despublica el último examen publicado: sin este barrido esos alumnos ya no
 * tienen ninguna acción que dispare el recomputo (re-completar lección da 409)
 * y quedarían ACTIVE para siempre. Acotado al curso y reutiliza la recomputación
 * idempotente por alumno (con sus efectos de finalización solo si transiciona).
 */
export async function recomputeCourseCompletionForCourse(
  client: PrismaClient,
  opts: { courseId: string; courseTitle: string }
): Promise<{ recomputed: number; completed: number }> {
  const enrollments = await client.enrollment.findMany({
    where: { courseId: opts.courseId, status: "ACTIVE", progressPercent: { gte: 100 } },
    select: { userId: true }
  });

  let completed = 0;
  for (const enrollment of enrollments) {
    const result = await recomputeCourseCompletion(client, {
      userId: enrollment.userId,
      courseId: opts.courseId,
      courseTitle: opts.courseTitle
    });
    if (result.newlyCompleted) {
      completed += 1;
    }
  }

  return { recomputed: enrollments.length, completed };
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : value.toNumber();
}
