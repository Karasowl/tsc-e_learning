import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { emitStudentNotification } from "../lib/notifications.js";
import {
  XP_LESSON_COMPLETED,
  awardCourseCompletionBadges,
  detectAscension,
  grantXp
} from "../lib/gamification.js";
import {
  computeCourseLock,
  computeExamLocked,
  computeSequentialLessons,
  computeStreak,
  isEnrollmentExpired,
  type CoursePrereq
} from "../lib/gating.js";

const courseRefSchema = z.object({
  courseRef: z.string().min(1)
});

const lessonRefSchema = z.object({
  lessonId: z.string().min(1)
});

export async function registerCourseRoutes(server: FastifyInstance) {
  server.get("/courses", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const courses = await getPrisma().course.findMany({
      where: courseAccessWhere(auth),
      include: {
        teacher: {
          select: {
            id: true,
            displayName: true,
            email: true
          }
        },
        enrollments: {
          where: { userId: auth.userId },
          take: 1
        },
        prerequisites: {
          include: {
            requires: { select: { id: true, title: true } }
          }
        },
        _count: {
          select: {
            enrollments: true,
            lessons: true,
            quizzes: true
          }
        }
      },
      orderBy: [{ publishedAt: "desc" }, { title: "asc" }]
    });

    const completedCourseIds = await completedCourseIdSet(auth.userId);
    const now = new Date();

    const thumbnails = await thumbnailMap(courses.map((course) => course.thumbnailAssetId).filter((id): id is string => Boolean(id)));

    return {
      courses: courses.map((course) => {
        const lock = computeCourseLock(
          course.prerequisites.map((prereq) => ({ requiresId: prereq.requiresId, requiresTitle: prereq.requires.title })),
          completedCourseIds
        );
        const enrollment = course.enrollments[0] ?? null;
        return {
          id: course.id,
          title: course.title,
          slug: course.slug,
          excerpt: course.excerpt,
          status: course.status,
          level: course.level,
          durationSec: course.durationSec,
          teacher: course.teacher,
          thumbnail: course.thumbnailAssetId ? thumbnails.get(course.thumbnailAssetId) ?? null : null,
          enrolled: course.enrollments.length > 0,
          progressPercent: decimalToNumber(enrollment?.progressPercent ?? null),
          counts: course._count,
          // Campos aditivos (Ola 2, Fase A): informativos, sin enforcement.
          locked: lock.locked,
          lockReason: lock.lockReason,
          expiresAt: enrollment?.expiresAt ?? null,
          expired: isEnrollmentExpired(enrollment?.expiresAt ?? null, now)
        };
      })
    };
  });

  server.get("/courses/:courseRef", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = courseRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const course = await getPrisma().course.findFirst({
      where: {
        AND: [
          {
            OR: [{ id: parsed.data.courseRef }, { slug: parsed.data.courseRef }]
          },
          courseAccessWhere(auth)
        ]
      },
      include: {
        teacher: {
          select: {
            id: true,
            displayName: true,
            email: true
          }
        },
        enrollments: {
          where: { userId: auth.userId },
          take: 1
        },
        prerequisites: {
          include: {
            requires: { select: { id: true, title: true } }
          }
        },
        modules: {
          orderBy: { position: "asc" },
          include: {
            lessons: {
              orderBy: { position: "asc" },
              include: {
                assets: true,
                progress: {
                  where: { userId: auth.userId },
                  take: 1
                }
              }
            },
            quizzes: {
              orderBy: { position: "asc" },
              include: {
                questions: {
                  select: { id: true }
                },
                attempts: {
                  where: { userId: auth.userId },
                  orderBy: { startedAt: "desc" },
                  take: 1
                }
              }
            }
          }
        }
      }
    });

    if (!course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    const thumbnail = course.thumbnailAssetId
      ? (await thumbnailMap([course.thumbnailAssetId])).get(course.thumbnailAssetId) ?? null
      : null;

    // --- Computo de candados (aditivo, informativo; sin enforcement) ---
    const now = new Date();
    const completedCourseIds = await completedCourseIdSet(auth.userId);
    const lock = computeCourseLock(
      course.prerequisites.map((prereq) => ({ requiresId: prereq.requiresId, requiresTitle: prereq.requires.title })),
      completedCourseIds
    );
    const prerequisitesView = course.prerequisites.map((prereq) => ({
      id: prereq.requires.id,
      title: prereq.requires.title,
      completed: completedCourseIds.has(prereq.requiresId)
    }));

    // Disponibilidad secuencial de lecciones, en orden de lectura del curso
    // (modulos por posicion, lecciones por posicion). Solo informativo.
    const orderedLessons = course.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({ id: lesson.id, completed: lesson.progress.length > 0 }))
    );
    const lessonGate = new Map(
      computeSequentialLessons(orderedLessons).map((lesson) => [lesson.id, { available: lesson.available, locked: lesson.locked }])
    );

    // Examen disponible solo con TODAS las lecciones del curso completas. Se
    // cuenta desde la base (incluye lecciones sin modulo) para ser consistente
    // con updateCourseProgress.
    const [totalLessons, completedLessons] = await Promise.all([
      getPrisma().lesson.count({ where: { courseId: course.id } }),
      getPrisma().lessonProgress.count({
        where: { userId: auth.userId, lesson: { courseId: course.id }, completedAt: { not: null } }
      })
    ]);
    const examLocked = computeExamLocked(totalLessons, completedLessons);

    const enrollment = course.enrollments[0] ?? null;

    return {
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.description,
        excerpt: course.excerpt,
        status: course.status,
        version: course.version,
        level: course.level,
        durationSec: course.durationSec,
        teacher: course.teacher,
        thumbnail,
        // Campos aditivos (Ola 2, Fase A): informativos, sin enforcement.
        locked: lock.locked,
        lockReason: lock.lockReason,
        examLocked,
        prerequisites: prerequisitesView,
        enrollment: enrollment
          ? {
              status: enrollment.status,
              progressPercent: decimalToNumber(enrollment.progressPercent),
              enrolledAt: enrollment.enrolledAt,
              completedAt: enrollment.completedAt,
              expiresAt: enrollment.expiresAt ?? null,
              expired: isEnrollmentExpired(enrollment.expiresAt ?? null, now)
            }
          : null,
        modules: course.modules.map((module) => ({
          id: module.id,
          title: module.title,
          position: module.position,
          lessons: module.lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            slug: lesson.slug,
            kind: lesson.kind,
            body: lesson.body,
            videoProvider: lesson.videoProvider,
            videoUrl: lesson.videoUrl,
            videoEmbed: lesson.videoEmbed,
            position: lesson.position,
            durationSec: lesson.durationSec,
            completed: lesson.progress.length > 0,
            completedAt: lesson.progress[0]?.completedAt ?? null,
            // Aditivo: bloqueo secuencial informativo.
            available: lessonGate.get(lesson.id)?.available ?? true,
            locked: lessonGate.get(lesson.id)?.locked ?? false,
            assets: lesson.assets.map(serializeAsset)
          })),
          quizzes: module.quizzes.map((quiz) => ({
            id: quiz.id,
            title: quiz.title,
            slug: quiz.slug,
            status: quiz.status,
            position: quiz.position,
            timeLimitSec: quiz.timeLimitSec,
            passingScorePercent: decimalToNumber(quiz.passingScorePercent),
            maxAttempts: quiz.maxAttempts,
            feedbackMode: quiz.feedbackMode,
            questionsOrder: quiz.questionsOrder,
            autoStart: quiz.autoStart,
            hideTimeDisplay: quiz.hideTimeDisplay,
            questionCount: quiz.questions.length,
            // Aditivo: mismo candado de examen a nivel de cada examen del curso.
            examLocked,
            lastAttempt: quiz.attempts[0] ? serializeAttemptSummary(quiz.attempts[0]) : null
          }))
        }))
      }
    };
  });

  server.post("/lessons/:lessonId/complete", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = lessonRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const lesson = await getPrisma().lesson.findUnique({
      where: { id: parsed.data.lessonId },
      include: {
        course: {
          include: {
            enrollments: {
              where: { userId: auth.userId },
              take: 1
            }
          }
        }
      }
    });

    if (!lesson) {
      return reply.code(404).send({ error: "Lesson not found" });
    }

    if (!canUseCourse(auth, lesson.course.teacherId, lesson.course.enrollments.length > 0)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    if (lesson.course.status === "ARCHIVED") {
      return reply.code(409).send({ error: "El curso está archivado" });
    }

    // Bloqueo duro (Fase C): un estudiante solo puede completar la leccion si el
    // curso no esta bloqueado por prerrequisitos y las lecciones anteriores (por
    // orden de lectura) ya estan completas. Docentes/admin quedan exentos para no
    // romper su vista de autoria/preview. El rechazo es 409 y no crea estado.
    if (!isAdmin(auth) && !auth.roles.includes("TEACHER")) {
      const [prerequisites, completedCourseIds, orderedLessons] = await Promise.all([
        coursePrerequisites(lesson.courseId),
        completedCourseIdSet(auth.userId),
        orderedLessonsWithProgress(auth.userId, lesson.courseId)
      ]);
      const gate = resolveLessonCompletionGate({
        prerequisites,
        completedCourseIds,
        orderedLessons,
        targetLessonId: lesson.id
      });
      if (!gate.allowed) {
        return reply.code(409).send({ error: gate.message });
      }
    }

    const completedAt = new Date();

    // Detecta si es la PRIMERA vez que esta leccion se completa: solo entonces la
    // actividad cuenta para la racha diaria (re-completar no la mueve).
    const existingProgress = await getPrisma().lessonProgress.findUnique({
      where: { userId_lessonId: { userId: auth.userId, lessonId: lesson.id } },
      select: { completedAt: true }
    });
    const firstCompletion = !existingProgress || existingProgress.completedAt === null;

    const progress = await getPrisma().lessonProgress.upsert({
      where: {
        userId_lessonId: {
          userId: auth.userId,
          lessonId: lesson.id
        }
      },
      update: {
        completedAt,
        lastSeenAt: completedAt
      },
      create: {
        userId: auth.userId,
        lessonId: lesson.id,
        completedAt,
        lastSeenAt: completedAt
      }
    });

    // Racha diaria: aditiva y robusta. Un fallo aqui nunca debe tumbar el
    // complete, asi que se aisla en su propio try/catch.
    if (firstCompletion) {
      try {
        const user = await getPrisma().user.findUnique({
          where: { id: auth.userId },
          select: { currentStreak: true, lastActiveDate: true }
        });
        if (user) {
          const next = computeStreak({
            lastActiveDate: user.lastActiveDate,
            currentStreak: user.currentStreak,
            now: completedAt
          });
          if (next.changed) {
            await getPrisma().user.update({
              where: { id: auth.userId },
              data: { currentStreak: next.currentStreak, lastActiveDate: next.lastActiveDate }
            });
          }
        }
      } catch (error) {
        request.log.error({ err: error }, "streak update failed");
      }
    }

    const courseProgress = await updateCourseProgress(auth.userId, lesson.courseId);
    if (courseProgress.newlyCompleted) {
      await logCourseCompleted(auth.userId, lesson.courseId, lesson.course.title);
      const completedCourses = await getPrisma().enrollment.count({
        where: { userId: auth.userId, status: "COMPLETED" }
      });
      await awardCourseCompletionBadges(getPrisma(), {
        userId: auth.userId,
        courseId: lesson.courseId,
        completedCourses,
        awardedAt: completedAt
      });
    }

    // XP real, idempotente: la primera vez que se completa la leccion suma
    // +10 XP; re-completar no vuelve a otorgar (la clave LESSON:<id> ya existe).
    const grant = await grantXp(getPrisma(), {
      userId: auth.userId,
      key: `LESSON:${lesson.id}`,
      points: XP_LESSON_COMPLETED,
      title: `Leccion completada: ${lesson.title}`,
      pointsType: "lesson",
      occurredAt: completedAt
    });
    const ascension = detectAscension(grant.xpTotal - grant.xpDelta, grant.xpTotal);

    return {
      progress: {
        lessonId: progress.lessonId,
        completedAt: progress.completedAt
      },
      courseProgress,
      gamification: {
        xpDelta: grant.xpDelta,
        xpTotal: grant.xpTotal,
        ascended: ascension.ascended,
        rankName: ascension.rankName
      }
    };
  });
}

async function logCourseCompleted(userId: string, courseId: string, courseTitle: string) {
  await emitStudentNotification({
    eventType: "COURSE_COMPLETED",
    userId,
    courseId,
    payload: { courseTitle }
  });
}

function courseAccessWhere(auth: AuthContext): Prisma.CourseWhereInput {
  if (isAdmin(auth)) {
    return { status: { not: "ARCHIVED" } };
  }

  if (auth.roles.includes("TEACHER")) {
    return {
      status: { not: "ARCHIVED" },
      OR: [
        { teacherId: auth.userId },
        {
          enrollments: {
            some: { userId: auth.userId }
          }
        }
      ]
    };
  }

  return {
    status: "PUBLISHED",
    enrollments: {
      some: { userId: auth.userId }
    }
  };
}

function canUseCourse(auth: AuthContext, teacherId: string | null, isEnrolled: boolean) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && teacherId === auth.userId) || isEnrolled;
}

async function updateCourseProgress(userId: string, courseId: string) {
  const [totalLessons, completedLessons] = await Promise.all([
    getPrisma().lesson.count({ where: { courseId } }),
    getPrisma().lessonProgress.count({
      where: {
        userId,
        lesson: { courseId },
        completedAt: { not: null }
      }
    })
  ]);

  const progressPercent = totalLessons > 0 ? Number(((completedLessons / totalLessons) * 100).toFixed(2)) : 0;
  const lessonsDone = totalLessons > 0 && completedLessons >= totalLessons;

  // A course is only "completed" when its lessons are done AND every published
  // quiz has a passing attempt, so a diploma can't be earned without passing the
  // exam(s). Courses with no published quiz complete on lessons alone.
  let quizzesPassed = true;
  if (lessonsDone) {
    const quizzes = await getPrisma().quiz.findMany({
      where: { courseId, status: "PUBLISHED" },
      select: { id: true }
    });
    if (quizzes.length > 0) {
      const quizIds = quizzes.map((quiz) => quiz.id);
      const passed = await getPrisma().quizAttempt.findMany({
        where: { userId, status: "PASSED", quizId: { in: quizIds } },
        select: { quizId: true },
        distinct: ["quizId"]
      });
      quizzesPassed = passed.length >= quizIds.length;
    }
  }
  const requirementsMet = lessonsDone && quizzesPassed;

  const enrollment = await getPrisma().enrollment.findUnique({
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

  const updated = await getPrisma().enrollment.update({
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
 * Enforcement (bloqueo duro, Fase C) para completar una leccion. Compone las
 * reglas puras de gating: el curso no debe estar bloqueado por prerrequisitos y
 * la leccion objetivo debe estar disponible por orden secuencial (todas las
 * anteriores completas). Devuelve el mensaje al estudiante cuando corresponde.
 * Pura y total para poder probarla sin base de datos.
 */
export function resolveLessonCompletionGate(input: {
  prerequisites: CoursePrereq[];
  completedCourseIds: Set<string>;
  orderedLessons: Array<{ id: string; completed: boolean }>;
  targetLessonId: string;
}): { allowed: boolean; message?: string } {
  const lock = computeCourseLock(input.prerequisites, input.completedCourseIds);
  if (lock.locked) {
    return { allowed: false, message: `Este curso está bloqueado: ${lock.lockReason}` };
  }

  const gate = computeSequentialLessons(input.orderedLessons);
  const target = gate.find((lesson) => lesson.id === input.targetLessonId);
  if (target && !target.available) {
    return { allowed: false, message: "Completa las lecciones anteriores antes de esta." };
  }

  return { allowed: true };
}

/** Prerrequisitos del curso, mapeados a la forma que consume computeCourseLock. */
async function coursePrerequisites(courseId: string): Promise<CoursePrereq[]> {
  const rows = await getPrisma().coursePrerequisite.findMany({
    where: { courseId },
    include: { requires: { select: { id: true, title: true } } }
  });
  return rows.map((row) => ({ requiresId: row.requiresId, requiresTitle: row.requires.title }));
}

/**
 * Lecciones del curso en orden de lectura (modulos por posicion, lecciones por
 * posicion) con su estado de completado para el usuario. Replica exactamente el
 * orden que el detalle del curso muestra, para que el enforcement coincida con
 * la disponibilidad secuencial que ve el estudiante.
 */
async function orderedLessonsWithProgress(userId: string, courseId: string) {
  const modules = await getPrisma().courseModule.findMany({
    where: { courseId },
    orderBy: { position: "asc" },
    include: {
      lessons: {
        orderBy: { position: "asc" },
        include: { progress: { where: { userId }, take: 1 } }
      }
    }
  });
  return modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ id: lesson.id, completed: lesson.progress.length > 0 }))
  );
}

/**
 * Conjunto de courseId que el usuario ya COMPLETO. Base para evaluar los
 * prerrequisitos de curso (un prereq esta cumplido si el usuario tiene una
 * inscripcion COMPLETED de ese curso).
 */
async function completedCourseIdSet(userId: string): Promise<Set<string>> {
  const rows = await getPrisma().enrollment.findMany({
    where: { userId, status: "COMPLETED" },
    select: { courseId: true }
  });
  return new Set(rows.map((row) => row.courseId));
}

async function thumbnailMap(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return new Map<string, ReturnType<typeof serializeAsset>>();
  }

  const assets = await getPrisma().asset.findMany({
    where: {
      id: { in: uniqueIds }
    }
  });

  return new Map(assets.map((asset) => [asset.id, serializeAsset(asset)]));
}

function serializeAsset(asset: {
  id: string;
  title: string;
  mimeType: string | null;
  storageKey: string;
  originalUrl: string | null;
  sizeBytes: bigint | null;
}) {
  return {
    id: asset.id,
    title: asset.title,
    mimeType: asset.mimeType,
    storageKey: asset.storageKey,
    originalUrl: asset.originalUrl,
    sizeBytes: asset.sizeBytes === null ? null : asset.sizeBytes.toString()
  };
}

function serializeAttemptSummary(attempt: {
  id: string;
  status: string;
  startedAt: Date;
  dueAt: Date | null;
  submittedAt: Date | null;
  scorePercent: Prisma.Decimal | null;
  totalQuestions: number | null;
  totalAnsweredQuestions: number | null;
  result: string | null;
}) {
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    dueAt: attempt.dueAt,
    submittedAt: attempt.submittedAt,
    scorePercent: decimalToNumber(attempt.scorePercent),
    totalQuestions: attempt.totalQuestions,
    totalAnsweredQuestions: attempt.totalAnsweredQuestions,
    result: attempt.result
  };
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : value.toNumber();
}
