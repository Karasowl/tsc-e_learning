import { randomUUID } from "node:crypto";
import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import { LocalStorageProvider } from "../lib/storage.js";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const assetFileParamsSchema = z.object({
  assetId: z.string().min(1)
});

const assetIdParamsSchema = z.object({
  assetId: z.string().min(1)
});

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip"
]);

function isAllowedMime(mime: string | null | undefined): boolean {
  if (!mime) {
    return false;
  }
  if (ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  return ALLOWED_MIME_EXACT.has(mime);
}

// Course material access: admins see everything; a teacher sees courses they own;
// a student must be enrolled in the owning course.
async function canAccessCourse(auth: AuthContext, courseId: string | null): Promise<boolean> {
  if (isAdmin(auth)) {
    return true;
  }
  if (!courseId) {
    return false;
  }
  const course = await getPrisma().course.findUnique({ where: { id: courseId } });
  if (!course) {
    return false;
  }
  if (auth.roles.includes("TEACHER") && course.teacherId === auth.userId) {
    return true;
  }
  const enrollment = await getPrisma().enrollment.findUnique({
    where: { userId_courseId: { userId: auth.userId, courseId } }
  });
  return Boolean(enrollment);
}

export async function registerAssetRoutes(server: FastifyInstance, config: AppConfig) {
  server.post("/assets", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "File is required" });
    }

    if (!isAllowedMime(data.mimetype)) {
      return reply.code(415).send({ error: "Tipo de archivo no permitido" });
    }

    // Optional association: when a lessonId field accompanies the upload (it must
    // be appended before the file in the form), attach the document to that
    // lesson so it shows up as a downloadable resource for students.
    const lessonIdField = data.fields?.lessonId;
    const lessonId =
      lessonIdField && !Array.isArray(lessonIdField) && "value" in lessonIdField
        ? String(lessonIdField.value)
        : null;

    let attachLessonId: string | null = null;
    let attachCourseId: string | null = null;
    if (lessonId) {
      const lesson = await getPrisma().lesson.findUnique({
        where: { id: lessonId },
        include: { course: true }
      });
      if (!lesson) {
        return reply.code(404).send({ error: "Lesson not found" });
      }
      if (!canEditCourse(auth, lesson.course)) {
        return reply.code(403).send({ error: "Course access denied" });
      }
      attachLessonId = lesson.id;
      attachCourseId = lesson.courseId;
    }

    const bytes = await data.toBuffer();
    const storageKey = "authored/" + randomUUID() + "/" + sanitizeFileName(data.filename);
    const provider = new LocalStorageProvider(config.localStorageRoot);
    const stored = await provider.putObject({ key: storageKey, bytes });

    const asset = await getPrisma().asset.create({
      data: {
        title: data.filename,
        mimeType: data.mimetype,
        storageKey: stored.key,
        checksum: stored.checksum,
        sizeBytes: BigInt(stored.sizeBytes),
        lessonId: attachLessonId,
        courseId: attachCourseId
      }
    });

    return reply.code(201).send({ asset: serializeAsset(asset) });
  });

  server.delete("/admin/assets/:assetId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const parsed = assetIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const asset = await getPrisma().asset.findUnique({
      where: { id: parsed.data.assetId },
      include: { lesson: { include: { course: true } }, course: true }
    });

    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    // Resolve the owning course (directly or via the lesson) to authorize.
    const course = asset.course ?? asset.lesson?.course ?? null;
    if (course && !canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "Course access denied" });
    }

    await getPrisma().asset.delete({ where: { id: asset.id } });

    // Remove the stored blob too, so deletions don't leak storage.
    try {
      await new LocalStorageProvider(config.localStorageRoot).deleteObject(asset.storageKey);
    } catch (cleanupError) {
      request.log.warn({ err: cleanupError }, "No se pudo borrar el blob del asset");
    }

    return { deleted: true };
  });

  server.get("/assets/:assetId/file", async (request, reply) => {
    const parsed = assetFileParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const asset = await getPrisma().asset.findUnique({
      where: { id: parsed.data.assetId },
      include: { lesson: true }
    });

    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    // Images (course covers, in-lesson illustrations) stay public so they render
    // in <img> tags. Documents (PDF/Office/etc.) are course material: require an
    // authenticated user with access to the owning course.
    const isImage = (asset.mimeType ?? "").startsWith("image/");
    if (!isImage) {
      const auth = await requireAuth(server, request, reply);
      if (!auth) {
        return;
      }
      const courseId = asset.courseId ?? asset.lesson?.courseId ?? null;
      if (!(await canAccessCourse(auth, courseId))) {
        return reply.code(403).send({ error: "No tienes acceso a este material" });
      }
    }

    const provider = new LocalStorageProvider(config.localStorageRoot);
    const bytes = await provider.getObject(asset.storageKey);

    return reply.header("content-type", asset.mimeType ?? "application/octet-stream").send(bytes);
  });
}

function sanitizeFileName(filename: string) {
  return filename.replaceAll("\\", "/").split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function serializeAsset(asset: {
  id: string;
  title: string;
  mimeType: string | null;
  storageKey: string;
  checksum: string | null;
  sizeBytes: bigint | null;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    title: asset.title,
    mimeType: asset.mimeType,
    storageKey: asset.storageKey,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes === null ? null : Number(asset.sizeBytes),
    createdAt: asset.createdAt
  };
}
