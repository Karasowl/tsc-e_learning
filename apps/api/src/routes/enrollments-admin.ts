import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAdminAction } from "../lib/audit.js";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { isEnrollmentExpired } from "../lib/gating.js";

const courseIdSchema = z.object({
  courseId: z.string().min(1)
});

const enrollmentStatusSchema = z.enum(["ACTIVE", "COMPLETED", "SUSPENDED", "EXPIRED"]);

const masterListSchema = z.object({
  courseId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  q: z.string().trim().optional(),
  status: enrollmentStatusSchema.optional(),
  sourceSystem: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

// expiresAt: cadena ISO para fijar la fecha, o null para limpiarla. Al menos uno
// de expiresAt/status debe venir para que la acción masiva tenga efecto.
const bulkUpdateSchema = z
  .object({
    enrollmentIds: z.array(z.string().min(1)).min(1).max(500),
    expiresAt: z.string().min(1).nullable().optional(),
    status: enrollmentStatusSchema.optional()
  })
  .refine((value) => value.expiresAt !== undefined || value.status !== undefined, {
    message: "Indica la fecha de vencimiento o el estado"
  });

const enrollmentParamsSchema = z.object({
  courseId: z.string().min(1),
  userId: z.string().min(1)
});

const listStudentsSchema = z.object({
  q: z.string().trim().optional(),
  courseId: z.string().min(1).optional()
});

const createStudentSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(6).max(4096),
  serviceLabel: z.string().min(1).optional()
});

// Accept either an existing user id or an email so the admin can grant access by
// whichever they have at hand.
const enrollSchema = z
  .object({
    userId: z.string().min(1).optional(),
    email: z.string().email().optional()
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: "Indica el usuario o el correo"
  });

export async function registerEnrollmentAdminRoutes(server: FastifyInstance) {
  // Padrón maestro de inscripciones (global, admin). Filtros por curso, usuario/q,
  // estado (incluido el EXPIRED derivado por expiresAt), origen y paginación.
  server.get("/admin/enrollments", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const query = masterListSchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }

    const now = new Date();
    const where: Prisma.EnrollmentWhereInput = {};
    if (query.data.courseId) {
      where.courseId = query.data.courseId;
    }
    if (query.data.userId) {
      where.userId = query.data.userId;
    }
    const sourceSystem = resolveSourceSystemFilter(query.data.sourceSystem);
    if (sourceSystem !== undefined) {
      where.sourceSystem = sourceSystem;
    }
    if (query.data.q) {
      where.user = {
        OR: [
          { displayName: { contains: query.data.q, mode: "insensitive" } },
          { email: { contains: query.data.q, mode: "insensitive" } },
          { employeeCode: { contains: query.data.q, mode: "insensitive" } }
        ]
      };
    }
    // EXPIRED es a la vez enum y estado derivado: una inscripción cuenta como
    // vencida si su status ya es EXPIRED o si su expiresAt ya pasó.
    if (query.data.status === "EXPIRED") {
      where.OR = [{ status: "EXPIRED" }, { expiresAt: { lt: now } }];
    } else if (query.data.status) {
      where.status = query.data.status;
    }

    const skip = (query.data.page - 1) * query.data.pageSize;
    const [rows, total] = await Promise.all([
      getPrisma().enrollment.findMany({
        where,
        orderBy: [{ enrolledAt: "desc" }],
        skip,
        take: query.data.pageSize,
        include: {
          user: { select: { id: true, displayName: true, email: true, employeeCode: true, serviceLabel: true } },
          course: { select: { id: true, title: true, slug: true } }
        }
      }),
      getPrisma().enrollment.count({ where })
    ]);

    return {
      enrollments: rows.map((row) => serializeMasterEnrollment(row, now)),
      total,
      page: query.data.page,
      pageSize: query.data.pageSize
    };
  });

  // Acción masiva: fija expiresAt y/o status sobre un conjunto de inscripciones.
  server.post("/admin/enrollments/bulk", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const body = bulkUpdateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const data: Prisma.EnrollmentUpdateManyMutationInput = {};
    if (body.data.status !== undefined) {
      data.status = body.data.status;
    }
    if (body.data.expiresAt !== undefined) {
      if (body.data.expiresAt === null) {
        data.expiresAt = null;
      } else {
        const parsedDate = new Date(body.data.expiresAt);
        if (Number.isNaN(parsedDate.getTime())) {
          return reply.code(400).send({ error: "expiresAt no es una fecha válida" });
        }
        data.expiresAt = parsedDate;
      }
    }

    const result = await getPrisma().enrollment.updateMany({
      where: { id: { in: body.data.enrollmentIds } },
      data
    });

    await logAdminAction({
      actorId: auth.userId,
      action: "ENROLLMENT_BULK_UPDATED",
      summary: `Actualizó ${result.count} inscripción(es) de forma masiva`,
      targetType: "enrollment",
      metadata: {
        count: result.count,
        requested: body.data.enrollmentIds.length,
        ...(body.data.status !== undefined ? { status: body.data.status } : {}),
        ...(body.data.expiresAt !== undefined ? { expiresAt: body.data.expiresAt } : {})
      },
      logger: request.log
    });

    return { updated: result.count };
  });

  // Search the people the admin can grant access to. Limited to STUDENT accounts.
  server.get("/admin/students", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const query = listStudentsSchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }

    const term = query.data.q;
    const where: Prisma.UserWhereInput = {
      roles: { some: { role: "STUDENT" } }
    };
    if (term) {
      where.OR = [
        { displayName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } }
      ];
    }

    const users = await getPrisma().user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: 50,
      select: { id: true, displayName: true, email: true, status: true, serviceLabel: true }
    });

    // When a course is provided, flag who is already enrolled so the UI can
    // show "ya inscrito" instead of offering to add them again.
    let enrolledIds = new Set<string>();
    if (query.data.courseId) {
      const enrollments = await getPrisma().enrollment.findMany({
        where: { courseId: query.data.courseId, userId: { in: users.map((u) => u.id) } },
        select: { userId: true }
      });
      enrolledIds = new Set(enrollments.map((e) => e.userId));
    }

    return {
      students: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        status: user.status,
        serviceLabel: user.serviceLabel,
        enrolled: enrolledIds.has(user.id)
      }))
    };
  });

  // Create a brand-new student account (e.g. a newly hired guard) so the admin
  // can immediately grant them access to a course.
  server.post("/admin/students", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const body = createStudentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const email = body.data.email.toLowerCase();
    const existing = await getPrisma().user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    }

    const passwordHash = await hashApplicationPassword(body.data.password);
    const user = await getPrisma().user.create({
      data: {
        email,
        displayName: body.data.displayName,
        serviceLabel: body.data.serviceLabel ?? null,
        status: "ACTIVE",
        passwordHash,
        roles: { create: [{ role: "STUDENT" }] }
      },
      select: { id: true, displayName: true, email: true, status: true, serviceLabel: true }
    });

    return reply.code(201).send({ student: { ...user, enrolled: false } });
  });

  // List who has access to a course, with their progress.
  server.get("/admin/courses/:courseId/enrollments", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = courseIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({ where: { id: params.data.courseId } });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const enrollments = await getPrisma().enrollment.findMany({
      where: { courseId: course.id },
      orderBy: [{ enrolledAt: "desc" }],
      include: { user: { select: { id: true, displayName: true, email: true, serviceLabel: true } } }
    });

    return {
      enrollments: enrollments.map(serializeEnrollment)
    };
  });

  // Grant a student access to a course (idempotent: reactivates a suspended one).
  server.post("/admin/courses/:courseId/enrollments", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = courseIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = enrollSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({ where: { id: params.data.courseId } });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const user = body.data.userId
      ? await getPrisma().user.findUnique({ where: { id: body.data.userId } })
      : await getPrisma().user.findUnique({ where: { email: body.data.email!.toLowerCase() } });

    if (!user) {
      return reply.code(404).send({ error: "No se encontró ese estudiante" });
    }

    const enrollment = await getPrisma().enrollment.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      // Re-granting access to a suspended enrollment reactivates it without
      // wiping the progress they already had.
      update: { status: "ACTIVE" },
      create: { userId: user.id, courseId: course.id, status: "ACTIVE" },
      include: { user: { select: { id: true, displayName: true, email: true, serviceLabel: true } } }
    });

    await logAdminAction({
      actorId: auth.userId,
      action: "ENROLLMENT_GRANTED",
      summary: `Inscribió a ${enrollment.user.displayName} en ${course.title}`,
      targetType: "course",
      targetId: course.id,
      metadata: { userId: user.id, courseTitle: course.title },
      logger: request.log
    });

    return reply.code(201).send({ enrollment: serializeEnrollment(enrollment) });
  });

  // Revoke access.
  server.delete("/admin/courses/:courseId/enrollments/:userId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = enrollmentParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({ where: { id: params.data.courseId } });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const enrollment = await getPrisma().enrollment.findUnique({
      where: { userId_courseId: { userId: params.data.userId, courseId: course.id } },
      include: { user: { select: { displayName: true } } }
    });
    if (!enrollment) {
      return reply.code(404).send({ error: "No se encontró la inscripción" });
    }

    await getPrisma().enrollment.delete({ where: { id: enrollment.id } });

    await logAdminAction({
      actorId: auth.userId,
      action: "ENROLLMENT_REVOKED",
      summary: `Revocó el acceso de ${enrollment.user.displayName} a ${course.title}`,
      targetType: "course",
      targetId: course.id,
      metadata: { userId: params.data.userId, courseTitle: course.title },
      logger: request.log
    });

    return { deleted: true };
  });
}

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

/**
 * Traduce el query param sourceSystem del padrón al filtro de Prisma. Las altas
 * nativas de la plataforma guardan sourceSystem null, así que el valor sentinela
 * `none` mapea a IS NULL (sourceSystem: null); cualquier otro valor filtra por
 * igualdad y la ausencia (o vacío) no filtra. Pura para poder probarse sin base
 * de datos.
 */
export function resolveSourceSystemFilter(value: string | undefined): string | null | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "none") {
    return null;
  }
  return value;
}

export function serializeMasterEnrollment(
  enrollment: {
    id: string;
    userId: string;
    courseId: string;
    status: string;
    progressPercent: Prisma.Decimal;
    enrolledAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
    sourceSystem: string | null;
    user: { id: string; displayName: string; email: string; employeeCode: string | null; serviceLabel: string | null };
    course: { id: string; title: string; slug: string };
  },
  now: Date
) {
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    user: {
      id: enrollment.user.id,
      displayName: enrollment.user.displayName,
      email: enrollment.user.email,
      employeeCode: enrollment.user.employeeCode,
      serviceLabel: enrollment.user.serviceLabel
    },
    course: {
      id: enrollment.course.id,
      title: enrollment.course.title,
      slug: enrollment.course.slug
    },
    status: enrollment.status,
    progressPercent: enrollment.progressPercent.toNumber(),
    enrolledAt: enrollment.enrolledAt,
    completedAt: enrollment.completedAt,
    expiresAt: enrollment.expiresAt,
    expired: isEnrollmentExpired(enrollment.expiresAt, now),
    sourceSystem: enrollment.sourceSystem
  };
}

function serializeEnrollment(enrollment: {
  userId: string;
  status: string;
  progressPercent: Prisma.Decimal;
  enrolledAt: Date;
  completedAt: Date | null;
  user: { id: string; displayName: string; email: string; serviceLabel: string | null };
}) {
  return {
    userId: enrollment.userId,
    displayName: enrollment.user.displayName,
    email: enrollment.user.email,
    serviceLabel: enrollment.user.serviceLabel,
    status: enrollment.status,
    progressPercent: enrollment.progressPercent.toNumber(),
    enrolledAt: enrollment.enrolledAt,
    completedAt: enrollment.completedAt
  };
}
