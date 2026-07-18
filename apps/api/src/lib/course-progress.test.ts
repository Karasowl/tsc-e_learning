import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  recomputeCourseCompletion,
  recomputeCourseCompletionForCourse,
  updateCourseProgress
} from "./course-progress.js";

// ---------------------------------------------------------------------------
// Fake Prisma en memoria con lo mínimo que consume la recomputación de
// finalización: conteos de lecciones, exámenes publicados, intentos aprobados,
// la inscripción, y los efectos (log de notificación + insignias). Permite
// probar la transición ACTIVE→COMPLETED sin base de datos.
// ---------------------------------------------------------------------------
type EnrollmentRow = {
  status: string;
  completedAt: Date | null;
  progressPercent: Prisma.Decimal;
};

function makeFakePrisma(state: {
  totalLessons: number;
  completedLessons: number;
  publishedQuizIds: string[];
  passedQuizIds: string[];
  enrollment: EnrollmentRow | null;
}) {
  const notificationLogs: Array<{ eventType: string }> = [];
  const awards: Array<{ achievementId: string }> = [];
  const enrollmentRow = state.enrollment;

  const fake = {
    lesson: {
      count: async () => state.totalLessons
    },
    lessonProgress: {
      count: async () => state.completedLessons
    },
    quiz: {
      // La consulta real filtra por status PUBLISHED; el fake ya recibe solo
      // los ids publicados (los DRAFT no aparecen aquí, igual que en Postgres).
      findMany: async () => state.publishedQuizIds.map((id) => ({ id }))
    },
    quizAttempt: {
      findMany: async ({ where }: { where: { quizId: { in: string[] } } }) =>
        state.passedQuizIds
          .filter((id) => where.quizId.in.includes(id))
          .map((quizId) => ({ quizId }))
    },
    enrollment: {
      findUnique: async () => (enrollmentRow ? { ...enrollmentRow } : null),
      update: async ({
        data
      }: {
        data: { progressPercent: number; completedAt: Date | null; status: string };
      }) => {
        if (!enrollmentRow) {
          throw new Error("no enrollment");
        }
        enrollmentRow.status = data.status;
        enrollmentRow.completedAt = data.completedAt;
        enrollmentRow.progressPercent = new Prisma.Decimal(data.progressPercent);
        return { ...enrollmentRow };
      },
      count: async () => (enrollmentRow?.status === "COMPLETED" ? 1 : 0)
    },
    user: {
      findUnique: async () => ({ email: "alumno@tsc.com.mx", displayName: "Alumno Prueba" })
    },
    notificationRule: {
      findMany: async () => []
    },
    notificationLog: {
      create: async ({ data }: { data: { eventType: string } }) => {
        notificationLogs.push(data);
        return data;
      }
    },
    achievement: {
      findUnique: async ({ where }: { where: { slug: string } }) => ({
        id: `ach-${where.slug}`,
        slug: where.slug,
        points: 10
      })
    },
    achievementAward: {
      findFirst: async ({ where }: { where: { achievementId: string } }) =>
        awards.find((award) => award.achievementId === where.achievementId) ?? null,
      create: async ({ data }: { data: { achievementId: string } }) => {
        awards.push(data);
        return data;
      }
    }
  };

  return {
    fake: fake as unknown as PrismaClient,
    notificationLogs,
    awards,
    enrollment: () => enrollmentRow
  };
}

function activeEnrollment(): EnrollmentRow {
  return { status: "ACTIVE", completedAt: null, progressPercent: new Prisma.Decimal(100) };
}

describe("recomputeCourseCompletion (finalización al aprobar el examen final)", () => {
  it("transiciona ACTIVE→COMPLETED, emite COURSE_COMPLETED y otorga insignias cuando el examen final se aprueba", async () => {
    const { fake, notificationLogs, awards, enrollment } = makeFakePrisma({
      totalLessons: 2,
      completedLessons: 2,
      publishedQuizIds: ["q1"],
      passedQuizIds: ["q1"],
      enrollment: activeEnrollment()
    });

    const result = await recomputeCourseCompletion(fake, {
      userId: "u1",
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.equal(result.newlyCompleted, true);
    assert.equal(enrollment()?.status, "COMPLETED");
    assert.ok(enrollment()?.completedAt instanceof Date);
    assert.deepEqual(
      notificationLogs.map((log) => log.eventType),
      ["COURSE_COMPLETED"]
    );
    assert.ok(
      awards.some((award) => award.achievementId === "ach-primer-diploma"),
      "debe otorgar la insignia de primer diploma"
    );
  });

  it("NO transiciona cuando el examen final publicado no está aprobado (reprobar no completa)", async () => {
    const { fake, notificationLogs, awards, enrollment } = makeFakePrisma({
      totalLessons: 2,
      completedLessons: 2,
      publishedQuizIds: ["q1"],
      passedQuizIds: [],
      enrollment: activeEnrollment()
    });

    const result = await recomputeCourseCompletion(fake, {
      userId: "u1",
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.equal(result.newlyCompleted, false);
    assert.equal(enrollment()?.status, "ACTIVE");
    assert.equal(notificationLogs.length, 0);
    assert.equal(awards.length, 0);
  });

  it("es idempotente: un curso ya COMPLETED no vuelve a notificar ni pierde su fecha", async () => {
    const originalCompletedAt = new Date("2025-03-01T00:00:00Z");
    const { fake, notificationLogs, awards, enrollment } = makeFakePrisma({
      totalLessons: 2,
      completedLessons: 2,
      publishedQuizIds: ["q1"],
      passedQuizIds: ["q1"],
      enrollment: {
        status: "COMPLETED",
        completedAt: originalCompletedAt,
        progressPercent: new Prisma.Decimal(100)
      }
    });

    const result = await recomputeCourseCompletion(fake, {
      userId: "u1",
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.equal(result.newlyCompleted, false);
    assert.equal(enrollment()?.status, "COMPLETED");
    assert.equal(enrollment()?.completedAt, originalCompletedAt);
    assert.equal(notificationLogs.length, 0);
    assert.equal(awards.length, 0);
  });

  it("completa por lecciones cuando el curso no tiene exámenes publicados", async () => {
    const { fake, enrollment } = makeFakePrisma({
      totalLessons: 3,
      completedLessons: 3,
      publishedQuizIds: [],
      passedQuizIds: [],
      enrollment: activeEnrollment()
    });

    const result = await recomputeCourseCompletion(fake, {
      userId: "u1",
      courseId: "c1",
      courseTitle: "Curso sin examen"
    });

    assert.equal(result.newlyCompleted, true);
    assert.equal(enrollment()?.status, "COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// Fake multiusuario para el barrido tras quitar un examen publicado: cada
// usuario tiene su propio avance de lecciones, intentos aprobados e
// inscripción, y enrollment.findMany respeta el filtro ACTIVE + >= 100%.
// ---------------------------------------------------------------------------
function makeSweepFakePrisma(state: {
  totalLessons: number;
  completedLessonsByUser: Record<string, number>;
  publishedQuizIds: string[];
  passedQuizIdsByUser: Record<string, string[]>;
  enrollments: Record<string, EnrollmentRow>;
}) {
  const notificationLogs: Array<{ eventType: string; userId: string }> = [];

  const fake = {
    lesson: {
      count: async () => state.totalLessons
    },
    lessonProgress: {
      count: async ({ where }: { where: { userId: string } }) =>
        state.completedLessonsByUser[where.userId] ?? 0
    },
    quiz: {
      findMany: async () => state.publishedQuizIds.map((id) => ({ id }))
    },
    quizAttempt: {
      findMany: async ({ where }: { where: { userId: string; quizId: { in: string[] } } }) =>
        (state.passedQuizIdsByUser[where.userId] ?? [])
          .filter((id) => where.quizId.in.includes(id))
          .map((quizId) => ({ quizId }))
    },
    enrollment: {
      findMany: async ({
        where
      }: {
        where: { status: string; progressPercent: { gte: number } };
      }) =>
        Object.entries(state.enrollments)
          .filter(
            ([, row]) =>
              row.status === where.status && row.progressPercent.toNumber() >= where.progressPercent.gte
          )
          .map(([userId]) => ({ userId })),
      findUnique: async ({ where }: { where: { userId_courseId: { userId: string } } }) => {
        const row = state.enrollments[where.userId_courseId.userId];
        return row ? { ...row } : null;
      },
      update: async ({
        where,
        data
      }: {
        where: { userId_courseId: { userId: string } };
        data: { progressPercent: number; completedAt: Date | null; status: string };
      }) => {
        const row = state.enrollments[where.userId_courseId.userId];
        if (!row) {
          throw new Error("no enrollment");
        }
        row.status = data.status;
        row.completedAt = data.completedAt;
        row.progressPercent = new Prisma.Decimal(data.progressPercent);
        return { ...row };
      },
      count: async ({ where }: { where: { userId: string; status: string } }) =>
        state.enrollments[where.userId]?.status === where.status ? 1 : 0
    },
    user: {
      findUnique: async () => ({ email: "alumno@tsc.com.mx", displayName: "Alumno" })
    },
    notificationRule: {
      findMany: async () => []
    },
    notificationLog: {
      create: async ({ data }: { data: { eventType: string; userId: string } }) => {
        notificationLogs.push(data);
        return data;
      }
    },
    achievement: {
      findUnique: async ({ where }: { where: { slug: string } }) => ({
        id: `ach-${where.slug}`,
        slug: where.slug,
        points: 10
      })
    },
    achievementAward: {
      findFirst: async () => null,
      create: async ({ data }: { data: { achievementId: string } }) => data
    }
  };

  return { fake: fake as unknown as PrismaClient, notificationLogs };
}

describe("recomputeCourseCompletionForCourse (barrido tras quitar el examen publicado)", () => {
  it("completa a los alumnos con lecciones al 100% cuando ya no queda examen publicado, sin tocar a los que van a medias", async () => {
    const enrollments: Record<string, EnrollmentRow> = {
      u1: { status: "ACTIVE", completedAt: null, progressPercent: new Prisma.Decimal(100) },
      u2: { status: "ACTIVE", completedAt: null, progressPercent: new Prisma.Decimal(50) }
    };
    const { fake, notificationLogs } = makeSweepFakePrisma({
      totalLessons: 2,
      completedLessonsByUser: { u1: 2, u2: 1 },
      publishedQuizIds: [],
      passedQuizIdsByUser: {},
      enrollments
    });

    const result = await recomputeCourseCompletionForCourse(fake, {
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.deepEqual(result, { recomputed: 1, completed: 1 });
    assert.equal(enrollments.u1!.status, "COMPLETED");
    assert.ok(enrollments.u1!.completedAt instanceof Date);
    assert.equal(enrollments.u2!.status, "ACTIVE");
    assert.equal(enrollments.u2!.completedAt, null);
    assert.deepEqual(
      notificationLogs.map((log) => [log.eventType, log.userId]),
      [["COURSE_COMPLETED", "u1"]]
    );
  });

  it("no completa cuando aún queda otro examen publicado sin aprobar", async () => {
    const enrollments: Record<string, EnrollmentRow> = {
      u1: { status: "ACTIVE", completedAt: null, progressPercent: new Prisma.Decimal(100) }
    };
    const { fake, notificationLogs } = makeSweepFakePrisma({
      totalLessons: 2,
      completedLessonsByUser: { u1: 2 },
      publishedQuizIds: ["q2"],
      passedQuizIdsByUser: { u1: [] },
      enrollments
    });

    const result = await recomputeCourseCompletionForCourse(fake, {
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.deepEqual(result, { recomputed: 1, completed: 0 });
    assert.equal(enrollments.u1!.status, "ACTIVE");
    assert.equal(notificationLogs.length, 0);
  });

  it("no hace nada cuando no hay inscripciones ACTIVE al 100%", async () => {
    const enrollments: Record<string, EnrollmentRow> = {
      u1: { status: "COMPLETED", completedAt: new Date("2025-01-01T00:00:00Z"), progressPercent: new Prisma.Decimal(100) }
    };
    const { fake, notificationLogs } = makeSweepFakePrisma({
      totalLessons: 2,
      completedLessonsByUser: { u1: 2 },
      publishedQuizIds: [],
      passedQuizIdsByUser: {},
      enrollments
    });

    const result = await recomputeCourseCompletionForCourse(fake, {
      courseId: "c1",
      courseTitle: "Custodia de Mercancía"
    });

    assert.deepEqual(result, { recomputed: 0, completed: 0 });
    assert.equal(notificationLogs.length, 0);
  });
});

describe("updateCourseProgress (avance sin efectos)", () => {
  it("no marca COMPLETED con lecciones pendientes aunque el examen esté aprobado", async () => {
    const { fake, enrollment } = makeFakePrisma({
      totalLessons: 3,
      completedLessons: 2,
      publishedQuizIds: ["q1"],
      passedQuizIds: ["q1"],
      enrollment: activeEnrollment()
    });

    const result = await updateCourseProgress(fake, "u1", "c1");

    assert.equal(result.newlyCompleted, false);
    assert.equal(enrollment()?.status, "ACTIVE");
    assert.equal(result.progressPercent, 66.67);
  });

  it("devuelve el avance sin tocar nada cuando no hay inscripción", async () => {
    const { fake } = makeFakePrisma({
      totalLessons: 2,
      completedLessons: 2,
      publishedQuizIds: [],
      passedQuizIds: [],
      enrollment: null
    });

    const result = await updateCourseProgress(fake, "u1", "c1");

    assert.equal(result.newlyCompleted, false);
    assert.equal(result.completedAt, null);
  });
});
