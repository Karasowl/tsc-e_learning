import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import {
  effectivePassingPercent,
  parseRulesSnapshot,
  snapshotSeal,
  type RulesSnapshot
} from "../lib/rules-snapshot.js";

const reportQuerySchema = z.object({
  courseId: z.string().optional()
});

const exportQuerySchema = z.object({
  courseId: z.string().optional(),
  q: z.string().trim().optional(),
  // Mismos valores que produce el veredicto (y que usa el filtro de estado de la
  // pantalla del instructor): el Excel debe poder acotarse igual que la tabla.
  status: z
    .enum(["En Progreso", "No hay examen", "Pendiente", "Examen sin realizar", "Aprobado", "Reprobado"])
    .optional()
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

    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    // El Excel respeta la misma búsqueda y filtro de estado que la pantalla,
    // para que lo exportado coincida con lo que el admin está viendo.
    const report = filterStudentReport(
      await buildStudentReport(auth, parsed.data.courseId),
      parsed.data.q,
      parsed.data.status
    );
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
        // El veredicto se emite contra el examen final PUBLICADO: un borrador o
        // un examen archivado no puede decidir Aprobado/Reprobado.
        where: { status: "PUBLISHED" },
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
      // The verdict is locked to the rules the student rendered under (the seal),
      // not the live exam. Sealed attempts carry a snapshot; older ones fall back.
      const snapshot = attempt ? parseRulesSnapshot(attempt.rulesSnapshot) : null;
      const status = reportStatus(enrollment.status, finalQuiz, attempt, snapshot);

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
              submittedAt: attempt.submittedAt,
              // Evaluation seal for "Resultados con sello": whether the verdict is
              // locked, the course version pill, the frozen passing threshold, when
              // it was sealed, and a short integrity tag.
              sealed: snapshot !== null,
              rulesVersion: attempt.rulesVersion,
              passingScorePercent: effectivePassingPercent(
                snapshot,
                finalQuiz?.passingScorePercent ? finalQuiz.passingScorePercent.toNumber() : null
              ),
              sealedAt: snapshot?.capturedAt ?? null,
              seal: snapshot ? snapshotSeal(snapshot) : null
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

/**
 * Filtra las filas del reporte con la MISMA semántica que el filtro en pantalla
 * del instructor: estado del veredicto por igualdad exacta y búsqueda por
 * nombre, correo, servicio o curso (contiene el término, sin distinguir
 * mayúsculas). El resumen se recalcula sobre las filas filtradas. Pura para
 * poder probarse sin base de datos.
 */
export function filterStudentReport(
  report: StudentReport,
  q: string | undefined,
  status?: string | undefined
): StudentReport {
  const term = q?.trim().toLowerCase();
  if (!term && !status) {
    return report;
  }
  const rows = report.rows.filter((row) => {
    if (status && row.status !== status) {
      return false;
    }
    if (!term) {
      return true;
    }
    return (
      row.studentName.toLowerCase().includes(term) ||
      row.email.toLowerCase().includes(term) ||
      (row.serviceLabel ?? "").toLowerCase().includes(term) ||
      row.courseTitle.toLowerCase().includes(term)
    );
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
  // Single-course report: the owner (teacher of the course) or an admin may inspect
  // their own course's results even while it is a DRAFT (or ARCHIVED), so they can
  // validate before publishing. Access stays scoped — a teacher only ever sees a
  // course that is theirs; a courseId that is not theirs yields an empty report.
  if (courseId) {
    if (isAdmin(auth)) {
      return { id: courseId };
    }
    return { id: courseId, teacherId: auth.userId };
  }

  // Global report (no course filter): published courses only.
  const base: Prisma.CourseWhereInput = { status: "PUBLISHED" };
  if (isAdmin(auth)) {
    return base;
  }
  return { ...base, teacherId: auth.userId };
}

function reportStatus(
  enrollmentStatus: string,
  finalQuiz: { passingScorePercent: Prisma.Decimal | null } | null,
  attempt: {
    earnedMarks: Prisma.Decimal | null;
    totalMarks: Prisma.Decimal | null;
    scorePercent: Prisma.Decimal | null;
  } | null,
  snapshot: RulesSnapshot | null
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
  // Compare the frozen score against the SEALED passing threshold (the rule the
  // student rendered under), not the live exam. Attempts without a seal fall back
  // to the live quiz threshold, exactly as before this feature.
  const passingScorePercent = effectivePassingPercent(
    snapshot,
    finalQuiz.passingScorePercent ? finalQuiz.passingScorePercent.toNumber() : null
  );
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
