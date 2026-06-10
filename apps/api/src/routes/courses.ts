import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

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

    const thumbnails = await thumbnailMap(courses.map((course) => course.thumbnailAssetId).filter((id): id is string => Boolean(id)));

    return {
      courses: courses.map((course) => ({
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
        progressPercent: decimalToNumber(course.enrollments[0]?.progressPercent ?? null),
        counts: course._count
      }))
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

    return {
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.description,
        excerpt: course.excerpt,
        status: course.status,
        level: course.level,
        durationSec: course.durationSec,
        teacher: course.teacher,
        thumbnail,
        enrollment: course.enrollments[0]
          ? {
              status: course.enrollments[0].status,
              progressPercent: decimalToNumber(course.enrollments[0].progressPercent),
              enrolledAt: course.enrollments[0].enrolledAt,
              completedAt: course.enrollments[0].completedAt
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

    const completedAt = new Date();
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

    const courseProgress = await updateCourseProgress(auth.userId, lesson.courseId);
    if (courseProgress.newlyCompleted) {
      await logCourseCompleted(auth.userId, lesson.courseId, lesson.course.title);
    }

    return {
      progress: {
        lessonId: progress.lessonId,
        completedAt: progress.completedAt
      },
      courseProgress
    };
  });
}

async function logCourseCompleted(userId: string, courseId: string, courseTitle: string) {
  const rules = await getPrisma().notificationRule.findMany({
    where: {
      eventType: "COURSE_COMPLETED",
      enabled: true
    }
  });

  await Promise.all(
    rules.map((rule) =>
      getPrisma().notificationLog.create({
        data: {
          eventType: "COURSE_COMPLETED",
          userId,
          courseId,
          payload: {
            ruleId: rule.id,
            courseTitle
          },
          sentTo: rule.recipients,
          status: "PENDING"
        }
      })
    )
  );
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
