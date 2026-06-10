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

    return { deleted: true };
  });

  server.get("/assets/:assetId/file", async (request, reply) => {
    const parsed = assetFileParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const asset = await getPrisma().asset.findUnique({
      where: { id: parsed.data.assetId }
    });

    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
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
