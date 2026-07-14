import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const courseIdSchema = z.object({
  courseId: z.string().min(1)
});

const moduleIdSchema = z.object({
  moduleId: z.string().min(1)
});

const lessonIdSchema = z.object({
  lessonId: z.string().min(1)
});

const createCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  thumbnailAssetId: z.string().nullable().optional(),
  teacherId: z.string().optional()
});

const updateCourseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  thumbnailAssetId: z.string().nullable().optional(),
  teacherId: z.string().optional()
});

const createModuleSchema = z.object({
  title: z.string().min(1),
  position: z.number().int().optional()
});

const updateModuleSchema = z.object({
  title: z.string().min(1).optional(),
  position: z.number().int().optional()
});

const createLessonSchema = z.object({
  title: z.string().min(1),
  moduleId: z.string().optional(),
  kind: z.enum(["TEXT", "VIDEO", "RESOURCE", "MIXED"]).optional(),
  body: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  videoProvider: z.string().nullable().optional(),
  position: z.number().int().optional()
});

const updateLessonSchema = z.object({
  title: z.string().min(1).optional(),
  moduleId: z.string().optional(),
  kind: z.enum(["TEXT", "VIDEO", "RESOURCE", "MIXED"]).optional(),
  body: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  videoProvider: z.string().nullable().optional(),
  position: z.number().int().optional()
});

export async function registerCourseAdminRoutes(server: FastifyInstance) {
  server.post("/admin/courses", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const parsed = createCourseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const slug = await uniqueCourseSlug(parsed.data.title);
    const teacherId = isAdmin(auth) && parsed.data.teacherId ? parsed.data.teacherId : auth.userId;
    const status = parsed.data.status ?? "DRAFT";

    const data: Prisma.CourseUncheckedCreateInput = {
      title: parsed.data.title,
      slug,
      status,
      teacherId,
      publishedAt: status === "PUBLISHED" ? new Date() : null
    };
    if (parsed.data.description !== undefined) {
      data.description = parsed.data.description;
    }
    if (parsed.data.excerpt !== undefined) {
      data.excerpt = parsed.data.excerpt;
    }
    if (parsed.data.level !== undefined) {
      data.level = parsed.data.level;
    }
    if (parsed.data.thumbnailAssetId !== undefined) {
      data.thumbnailAssetId = parsed.data.thumbnailAssetId;
    }

    const course = await getPrisma().course.create({ data });

    return reply.code(201).send({ course: serializeCourse(course) });
  });

  server.put("/admin/courses/:courseId", async (request, reply) => {
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

    const body = updateCourseSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: params.data.courseId }
    });

    if (!course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    const data: Prisma.CourseUpdateInput = {};
    if (body.data.title !== undefined) {
      data.title = body.data.title;
    }
    if (body.data.description !== undefined) {
      data.description = body.data.description;
    }
    if (body.data.excerpt !== undefined) {
      data.excerpt = body.data.excerpt;
    }
    if (body.data.level !== undefined) {
      data.level = body.data.level;
    }
    if (body.data.thumbnailAssetId !== undefined) {
      data.thumbnailAssetId = body.data.thumbnailAssetId;
    }
    if (body.data.teacherId !== undefined && isAdmin(auth)) {
      data.teacher = { connect: { id: body.data.teacherId } };
    }
    if (body.data.status !== undefined) {
      data.status = body.data.status;
      if (body.data.status === "PUBLISHED" && course.publishedAt === null) {
        data.publishedAt = new Date();
      }
      // Publishing (any transition from a non-published state into PUBLISHED)
      // cuts a new immutable version: vN -> vN+1. Seed/already-published courses
      // keep their current version because they never cross this transition.
      if (body.data.status === "PUBLISHED" && course.status !== "PUBLISHED") {
        data.version = { increment: 1 };
      }
    }

    const updated = await getPrisma().course.update({
      where: { id: course.id },
      data
    });

    return { course: serializeCourse(updated) };
  });

  server.delete("/admin/courses/:courseId", async (request, reply) => {
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

    const course = await getPrisma().course.findUnique({
      where: { id: params.data.courseId }
    });

    if (!course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    await getPrisma().course.delete({
      where: { id: course.id }
    });

    return { deleted: true };
  });

  server.post("/admin/courses/:courseId/modules", async (request, reply) => {
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

    const body = createModuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: params.data.courseId }
    });

    if (!course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    const position = body.data.position ?? (await nextModulePosition(course.id));

    const module = await getPrisma().courseModule.create({
      data: {
        courseId: course.id,
        title: body.data.title,
        position
      }
    });

    return reply.code(201).send({ module });
  });

  server.put("/admin/modules/:moduleId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = moduleIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = updateModuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const module = await getPrisma().courseModule.findUnique({
      where: { id: params.data.moduleId },
      include: { course: true }
    });

    if (!module) {
      return reply.code(404).send({ error: "Module not found" });
    }

    if (!canEditCourse(auth, module.course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    if (body.data.position !== undefined && body.data.position !== module.position) {
      await reorderModule(module.courseId, module.id, body.data.position);
    }

    const updated = await getPrisma().courseModule.update({
      where: { id: module.id },
      data: {
        ...(body.data.title !== undefined ? { title: body.data.title } : {})
      }
    });

    return { module: updated };
  });

  server.delete("/admin/modules/:moduleId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = moduleIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const module = await getPrisma().courseModule.findUnique({
      where: { id: params.data.moduleId },
      include: { course: true }
    });

    if (!module) {
      return reply.code(404).send({ error: "Module not found" });
    }

    if (!canEditCourse(auth, module.course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    await getPrisma().courseModule.delete({
      where: { id: module.id }
    });

    return { deleted: true };
  });

  server.post("/admin/courses/:courseId/lessons", async (request, reply) => {
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

    const body = createLessonSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: params.data.courseId }
    });

    if (!course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    const slug = await uniqueLessonSlug(course.id, body.data.title);
    const position = body.data.position ?? (await nextLessonPosition(course.id));
    const videoProvider = resolveVideoProvider(body.data.videoUrl, body.data.videoProvider);

    const data: Prisma.LessonUncheckedCreateInput = {
      courseId: course.id,
      title: body.data.title,
      slug,
      kind: body.data.kind ?? "MIXED",
      position
    };
    if (body.data.moduleId !== undefined) {
      data.moduleId = body.data.moduleId;
    }
    if (body.data.body !== undefined) {
      data.body = body.data.body;
    }
    if (body.data.videoUrl !== undefined) {
      data.videoUrl = body.data.videoUrl;
    }
    if (videoProvider !== undefined) {
      data.videoProvider = videoProvider;
    }

    const lesson = await getPrisma().lesson.create({ data });

    return reply.code(201).send({ lesson });
  });

  server.put("/admin/lessons/:lessonId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = lessonIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = updateLessonSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const lesson = await getPrisma().lesson.findUnique({
      where: { id: params.data.lessonId },
      include: { course: true }
    });

    if (!lesson) {
      return reply.code(404).send({ error: "Lesson not found" });
    }

    if (!canEditCourse(auth, lesson.course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    if (body.data.position !== undefined && body.data.position !== lesson.position) {
      await reorderLesson(lesson.courseId, lesson.id, body.data.position);
    }

    const data: Prisma.LessonUpdateInput = {};
    if (body.data.title !== undefined) {
      data.title = body.data.title;
    }
    if (body.data.moduleId !== undefined) {
      data.module = body.data.moduleId ? { connect: { id: body.data.moduleId } } : { disconnect: true };
    }
    if (body.data.kind !== undefined) {
      data.kind = body.data.kind;
    }
    if (body.data.body !== undefined) {
      data.body = body.data.body;
    }
    if (body.data.videoUrl !== undefined) {
      data.videoUrl = body.data.videoUrl;
      data.videoProvider = resolveVideoProvider(body.data.videoUrl, body.data.videoProvider) ?? null;
    } else if (body.data.videoProvider !== undefined) {
      data.videoProvider = body.data.videoProvider;
    }

    const updated = await getPrisma().lesson.update({
      where: { id: lesson.id },
      data
    });

    return { lesson: updated };
  });

  server.delete("/admin/lessons/:lessonId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = lessonIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const lesson = await getPrisma().lesson.findUnique({
      where: { id: params.data.lessonId },
      include: { course: true }
    });

    if (!lesson) {
      return reply.code(404).send({ error: "Lesson not found" });
    }

    if (!canEditCourse(auth, lesson.course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    await getPrisma().lesson.delete({
      where: { id: lesson.id }
    });

    return { deleted: true };
  });
}

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

function isTeacherOrAdmin(auth: AuthContext) {
  return auth.roles.includes("ADMIN") || auth.roles.includes("TEACHER");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueCourseSlug(title: string) {
  const base = slugify(title) || "course";
  let candidate = base;
  let suffix = 2;

  while (await getPrisma().course.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function uniqueLessonSlug(courseId: string, title: string) {
  const base = slugify(title) || "lesson";
  let candidate = base;
  let suffix = 2;

  while (
    await getPrisma().lesson.findUnique({
      where: { courseId_slug: { courseId, slug: candidate } }
    })
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function resolveVideoProvider(
  videoUrl: string | null | undefined,
  videoProvider: string | null | undefined
) {
  if (videoUrl && videoUrl.toLowerCase().includes("youtube")) {
    return "youtube";
  }
  return videoProvider;
}

async function nextModulePosition(courseId: string) {
  const last = await getPrisma().courseModule.findFirst({
    where: { courseId },
    orderBy: { position: "desc" }
  });
  return (last?.position ?? 0) + 1;
}

async function nextLessonPosition(courseId: string) {
  const last = await getPrisma().lesson.findFirst({
    where: { courseId },
    orderBy: { position: "desc" }
  });
  return (last?.position ?? 0) + 1;
}

const POSITION_OFFSET = 1_000_000;

async function reorderModule(courseId: string, moduleId: string, targetPosition: number) {
  const modules = await getPrisma().courseModule.findMany({
    where: { courseId },
    orderBy: { position: "asc" }
  });

  const reordered = modules.filter((module) => module.id !== moduleId);
  const moving = modules.find((module) => module.id === moduleId);
  if (!moving) {
    return;
  }

  const insertIndex = Math.max(0, Math.min(targetPosition - 1, reordered.length));
  reordered.splice(insertIndex, 0, moving);

  await getPrisma().$transaction([
    ...reordered.map((module, index) =>
      getPrisma().courseModule.update({
        where: { id: module.id },
        data: { position: index + 1 + POSITION_OFFSET }
      })
    ),
    ...reordered.map((module, index) =>
      getPrisma().courseModule.update({
        where: { id: module.id },
        data: { position: index + 1 }
      })
    )
  ]);
}

async function reorderLesson(courseId: string, lessonId: string, targetPosition: number) {
  const lessons = await getPrisma().lesson.findMany({
    where: { courseId },
    orderBy: { position: "asc" }
  });

  const reordered = lessons.filter((lesson) => lesson.id !== lessonId);
  const moving = lessons.find((lesson) => lesson.id === lessonId);
  if (!moving) {
    return;
  }

  const insertIndex = Math.max(0, Math.min(targetPosition - 1, reordered.length));
  reordered.splice(insertIndex, 0, moving);

  await getPrisma().$transaction([
    ...reordered.map((lesson, index) =>
      getPrisma().lesson.update({
        where: { id: lesson.id },
        data: { position: index + 1 + POSITION_OFFSET }
      })
    ),
    ...reordered.map((lesson, index) =>
      getPrisma().lesson.update({
        where: { id: lesson.id },
        data: { position: index + 1 }
      })
    )
  ]);
}

function serializeCourse(course: {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  excerpt: string | null;
  status: string;
  version: number;
  teacherId: string | null;
  level: string | null;
  durationSec: number | null;
  thumbnailAssetId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: course.description,
    excerpt: course.excerpt,
    status: course.status,
    version: course.version,
    teacherId: course.teacherId,
    level: course.level,
    durationSec: course.durationSec,
    thumbnailAssetId: course.thumbnailAssetId,
    publishedAt: course.publishedAt,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt
  };
}
