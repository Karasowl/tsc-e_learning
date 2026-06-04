import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
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

type StudentReport = Awaited<ReturnType<typeof buildStudentReport>>;
type StudentReportRow = StudentReport["rows"][number];

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

    return buildStudentReport(auth, parsed.data.courseId);
  });

  server.get("/reports/students/export.xlsx", async (request, reply) => {
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

    const report = await buildStudentReport(auth, parsed.data.courseId);
    const workbook = buildReportWorkbook(report);
    const buffer = await workbook.xlsx.writeBuffer();

    return reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
      .header(
        "content-disposition",
        `attachment; filename="reporte-colaboradores-tsc.xlsx"`
      )
      .send(Buffer.from(buffer));
  });
}

async function buildStudentReport(auth: AuthContext, courseId: string | undefined) {
  const courseWhere = reportCourseWhere(auth, courseId);
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
}

function buildReportWorkbook(report: StudentReport) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TSC Capacita";

  const sheet = workbook.addWorksheet("Reporte colaboradores");
  sheet.columns = [
    { header: "Colaborador", key: "studentName", width: 32 },
    { header: "Correo", key: "email", width: 30 },
    { header: "Servicio", key: "serviceLabel", width: 24 },
    { header: "Curso", key: "courseTitle", width: 38 },
    { header: "Avance %", key: "progressPercent", width: 10 },
    { header: "Examen final", key: "finalQuiz", width: 34 },
    { header: "Puntaje %", key: "scorePercent", width: 10 },
    { header: "Estado", key: "status", width: 18 }
  ];

  for (const row of report.rows) {
    sheet.addRow({
      studentName: row.studentName,
      email: row.email,
      serviceLabel: row.serviceLabel ?? "Sin servicio",
      courseTitle: row.courseTitle,
      progressPercent: row.progressPercent ?? 0,
      finalQuiz: row.finalQuiz?.title ?? "Sin examen",
      scorePercent: row.latestAttempt?.scorePercent ?? "N/D",
      status: row.status
    });
  }

  styleHeaderRow(sheet.getRow(1));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "H1" };

  const summarySheet = workbook.addWorksheet("Resumen");
  summarySheet.columns = [
    { header: "Estado", key: "label", width: 24 },
    { header: "Colaboradores", key: "value", width: 16 }
  ];
  for (const [label, value] of Object.entries(report.summary)) {
    summarySheet.addRow({ label, value });
  }
  summarySheet.addRow({ label: "Total", value: report.rows.length });
  styleHeaderRow(summarySheet.getRow(1));

  return workbook;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF131A33" }
  };
  row.alignment = { vertical: "middle" };
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

export type { StudentReport, StudentReportRow };
