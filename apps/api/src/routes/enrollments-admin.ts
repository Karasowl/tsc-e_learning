import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAdminAction } from "../lib/audit.js";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const courseIdSchema = z.object({
  courseId: z.string().min(1)
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
    message: "Provide userId or email"
  });

export async function registerEnrollmentAdminRoutes(server: FastifyInstance) {
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
      return reply.code(404).send({ error: "Course not found" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
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
      return reply.code(404).send({ error: "Course not found" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
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
      return reply.code(404).send({ error: "Course not found" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    const enrollment = await getPrisma().enrollment.findUnique({
      where: { userId_courseId: { userId: params.data.userId, courseId: course.id } },
      include: { user: { select: { displayName: true } } }
    });
    if (!enrollment) {
      return reply.code(404).send({ error: "Enrollment not found" });
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
