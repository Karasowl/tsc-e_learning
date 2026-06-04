import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const reportQuerySchema = z.object({
  courseId: z.string().optional()
});

type StudentReportStatus =
  | "En Progreso"
  | "No hay examen"
  | "Pendiente"
  | "Examen sin realizar"
  | "Aprobado"
  | "Reprobado";

export async function registerReportRoutes(server: FastifyInstance) {
  server.get("/reports/students", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const courseWhere = reportCourseWhere(auth, parsed.data.courseId);
    const courses = await getPrisma().course.findMany({
      where: courseWhere,
      include: {
        quizzes: {
          orderBy: [{ position: "desc" }, { title: "desc" }],
          take: 1
        },
        enrollments: {
          include: {
            user: {
              include: {
                quizAttempts: {
                  orderBy: { startedAt: "desc" }
                }
              }
            }
          },
          orderBy: {
            enrolledAt: "desc"
          }
        }
      },
      orderBy: {
        title: "asc"
      }
    });

    const rows = courses.flatMap((course) => {
      const finalQuiz = course.quizzes[0] ?? null;

      return course.enrollments.map((enrollment) => {
        const attempt = finalQuiz
          ? enrollment.user.quizAttempts.find((candidate) => candidate.quizId === finalQuiz.id) ?? null
          : null;
        const status = reportStatus(enrollment.status, finalQuiz, attempt);

        return {
          studentId: enrollment.user.id,
          studentName: enrollment.user.displayName,
          email: enrollment.user.email,
          serviceLabel: enrollment.user.serviceLabel,
          courseId: course.id,
          courseTitle: course.title,
          enrollmentStatus: enrollment.status,
          progressPercent: decimalToNumber(enrollment.progressPercent),
          enrolledAt: enrollment.enrolledAt,
          completedAt: enrollment.completedAt,
          finalQuiz: finalQuiz
            ? {
                id: finalQuiz.id,
                title: finalQuiz.title,
                passingScorePercent: decimalToNumber(finalQuiz.passingScorePercent)
              }
            : null,
          latestAttempt: attempt
            ? {
                id: attempt.id,
                status: attempt.status,
                result: attempt.result,
                scorePercent: decimalToNumber(attempt.scorePercent),
                earnedMarks: decimalToNumber(attempt.earnedMarks),
                totalMarks: decimalToNumber(attempt.totalMarks),
                startedAt: attempt.startedAt,
                submittedAt: attempt.submittedAt
              }
            : null,
          status
        };
      });
    });

    return {
      summary: summarize(rows.map((row) => row.status)),
      rows
    };
  });
}

function reportCourseWhere(auth: AuthContext, courseId: string | undefined): Prisma.CourseWhereInput {
  const base: Prisma.CourseWhereInput = {
    status: "PUBLISHED"
  };

  if (courseId) {
    base.id = courseId;
  }

  if (isAdmin(auth)) {
    return base;
  }

  return {
    ...base,
    teacherId: auth.userId
  };
}

function reportStatus(
  enrollmentStatus: string,
  finalQuiz: { passingScorePercent: Prisma.Decimal | null } | null,
  attempt: {
    earnedMarks: Prisma.Decimal | null;
    totalMarks: Prisma.Decimal | null;
    scorePercent: Prisma.Decimal | null;
  } | null
): StudentReportStatus {
  if (enrollmentStatus === "ACTIVE") {
    return "En Progreso";
  }

  if (!finalQuiz) {
    return "No hay examen";
  }

  if (!attempt) {
    return "Pendiente";
  }

  if (!attempt.earnedMarks || !attempt.totalMarks || attempt.totalMarks.toNumber() <= 0) {
    return "Examen sin realizar";
  }

  const scorePercent = attempt.scorePercent?.toNumber() ?? (attempt.earnedMarks.toNumber() / attempt.totalMarks.toNumber()) * 100;
  const passingScorePercent = finalQuiz.passingScorePercent?.toNumber() ?? 80;
  return scorePercent >= passingScorePercent ? "Aprobado" : "Reprobado";
}

function summarize(statuses: StudentReportStatus[]) {
  return statuses.reduce<Record<StudentReportStatus, number>>(
    (summary, status) => ({
      ...summary,
      [status]: summary[status] + 1
    }),
    {
      "En Progreso": 0,
      "No hay examen": 0,
      Pendiente: 0,
      "Examen sin realizar": 0,
      Aprobado: 0,
      Reprobado: 0
    }
  );
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : value.toNumber();
}
