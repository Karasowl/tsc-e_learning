import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const courseIdSchema = z.object({
  courseId: z.string().min(1)
});

const announcementIdSchema = z.object({
  id: z.string().min(1)
});

const createCourseAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000)
});

const createGlobalAnnouncementSchema = createCourseAnnouncementSchema;

/** kind fijo de la bandeja para notificaciones que nacen de un anuncio. */
export const ANNOUNCEMENT_NOTIFICATION_KIND = "ANNOUNCEMENT";

export type AnnouncementNotificationSeed = {
  userIds: string[];
  title: string;
  body: string;
  linkType: string;
  linkId: string;
};

/**
 * Construye (puro, sin BD) las filas Notification de la bandeja in-app para un
 * anuncio. Deduplica userIds defensivamente para no crear dos avisos al mismo
 * usuario. El resultado alimenta directamente `notification.createMany`.
 */
export function buildAnnouncementNotifications(
  seed: AnnouncementNotificationSeed
): Array<{ userId: string; kind: string; title: string; body: string; linkType: string; linkId: string }> {
  const seen = new Set<string>();
  const rows: Array<{ userId: string; kind: string; title: string; body: string; linkType: string; linkId: string }> = [];
  for (const userId of seed.userIds) {
    if (seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    rows.push({
      userId,
      kind: ANNOUNCEMENT_NOTIFICATION_KIND,
      title: seed.title,
      body: seed.body,
      linkType: seed.linkType,
      linkId: seed.linkId
    });
  }
  return rows;
}

export function serializeAnnouncement(announcement: {
  id: string;
  scope: string;
  courseId: string | null;
  title: string;
  body: string;
  publishedAt: Date | null;
  createdAt: Date;
  author?: { displayName: string } | null;
  course?: { id: string; title: string } | null;
}) {
  return {
    id: announcement.id,
    scope: announcement.scope,
    courseId: announcement.courseId,
    courseTitle: announcement.course?.title ?? null,
    title: announcement.title,
    body: announcement.body,
    author: announcement.author?.displayName ?? null,
    publishedAt: announcement.publishedAt,
    createdAt: announcement.createdAt
  };
}

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

export async function registerAnnouncementRoutes(server: FastifyInstance) {
  // Instructor dueño (o admin) publica un anuncio de curso. Se publica de una vez
  // (publishedAt = ahora) y se siembra la bandeja in-app de cada estudiante con
  // acceso vigente (ACTIVE o COMPLETED) del curso.
  server.post("/admin/courses/:courseId/announcements", async (request, reply) => {
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
    const body = createCourseAnnouncementSchema.safeParse(request.body);
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

    const announcement = await getPrisma().announcement.create({
      data: {
        scope: "COURSE",
        courseId: course.id,
        authorId: auth.userId,
        title: body.data.title,
        body: body.data.body,
        publishedAt: new Date()
      },
      include: {
        author: { select: { displayName: true } },
        course: { select: { id: true, title: true } }
      }
    });

    // Bandeja in-app: un aviso por estudiante inscrito vigente. El correo masivo de
    // anuncios NO se envía aquí.
    // TODO: correo-masivo de anuncios es decisión de producto pendiente.
    const recipients = await getPrisma().enrollment.findMany({
      where: { courseId: course.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { userId: true }
    });
    const notifications = buildAnnouncementNotifications({
      userIds: recipients.map((row) => row.userId),
      title: announcement.title,
      body: announcement.body,
      linkType: "course",
      linkId: course.id
    });
    if (notifications.length > 0) {
      await getPrisma().notification.createMany({ data: notifications });
    }

    return reply.code(201).send({
      announcement: serializeAnnouncement(announcement),
      notified: notifications.length
    });
  });

  // Lista los anuncios de un curso (dueño/admin).
  server.get("/admin/courses/:courseId/announcements", async (request, reply) => {
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

    const announcements = await getPrisma().announcement.findMany({
      where: { courseId: course.id },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      include: {
        author: { select: { displayName: true } },
        course: { select: { id: true, title: true } }
      }
    });

    return { announcements: announcements.map(serializeAnnouncement) };
  });

  // Publica un anuncio GLOBAL (toda la plataforma). Solo admin. Siembra la bandeja
  // de todos los usuarios con rol STUDENT.
  server.post("/admin/announcements", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const body = createGlobalAnnouncementSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const announcement = await getPrisma().announcement.create({
      data: {
        scope: "GLOBAL",
        courseId: null,
        authorId: auth.userId,
        title: body.data.title,
        body: body.data.body,
        publishedAt: new Date()
      },
      include: {
        author: { select: { displayName: true } },
        course: { select: { id: true, title: true } }
      }
    });

    // TODO: correo-masivo de anuncios es decisión de producto pendiente.
    const students = await getPrisma().user.findMany({
      where: { roles: { some: { role: "STUDENT" } } },
      select: { id: true }
    });
    const notifications = buildAnnouncementNotifications({
      userIds: students.map((row) => row.id),
      title: announcement.title,
      body: announcement.body,
      linkType: "announcement",
      linkId: announcement.id
    });
    if (notifications.length > 0) {
      await getPrisma().notification.createMany({ data: notifications });
    }

    return reply.code(201).send({
      announcement: serializeAnnouncement(announcement),
      notified: notifications.length
    });
  });

  // Borra un anuncio. GLOBAL: solo admin. COURSE: dueño del curso o admin.
  server.delete("/admin/announcements/:id", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = announcementIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const announcement = await getPrisma().announcement.findUnique({
      where: { id: params.data.id },
      include: { course: { select: { teacherId: true } } }
    });
    if (!announcement) {
      return reply.code(404).send({ error: "Announcement not found" });
    }

    const allowed =
      announcement.scope === "GLOBAL"
        ? isAdmin(auth)
        : canEditCourse(auth, { teacherId: announcement.course?.teacherId ?? null });
    if (!allowed) {
      return reply.code(403).send({ error: "Announcement access denied" });
    }

    await getPrisma().announcement.delete({ where: { id: announcement.id } });
    return { deleted: true };
  });

  // Bandeja de anuncios del estudiante: los globales publicados + los de sus
  // cursos inscritos, más recientes primero.
  server.get("/me/announcements", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const enrollments = await getPrisma().enrollment.findMany({
      where: { userId: auth.userId },
      select: { courseId: true }
    });
    const courseIds = enrollments.map((row) => row.courseId);

    const where: Prisma.AnnouncementWhereInput = {
      publishedAt: { not: null },
      OR: [{ scope: "GLOBAL" }, { courseId: { in: courseIds } }]
    };

    const announcements = await getPrisma().announcement.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        author: { select: { displayName: true } },
        course: { select: { id: true, title: true } }
      }
    });

    return { announcements: announcements.map(serializeAnnouncement) };
  });
}
