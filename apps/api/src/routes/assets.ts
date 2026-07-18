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

const streamQuerySchema = z.object({
  token: z.string().min(1)
});

// El <video src> del alumno no puede mandar el header Authorization, así que el
// acceso al blob se autoriza con un token JWT corto (15 min) firmado por el mismo
// firmante del proyecto y acotado a un assetId concreto.
const ASSET_STREAM_SCOPE = "asset-stream";
const ASSET_STREAM_TTL = "15m";
const ASSET_STREAM_TTL_SECONDS = 15 * 60;

/**
 * Valida (puro) que el payload de un token de streaming corresponda al asset que
 * se pide. El token debe llevar el scope correcto y el mismo assetId de la URL,
 * de modo que un token emitido para un asset no sirva para otro.
 */
export function assetStreamClaimsValid(payload: unknown, assetId: string): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const claims = payload as { scope?: unknown; assetId?: unknown };
  return claims.scope === ASSET_STREAM_SCOPE && claims.assetId === assetId;
}

/**
 * Interpreta un header Range de una sola porción (`bytes=start-end`) contra un
 * blob de `size` bytes. Devuelve el rango [start,end] inclusivo saneado, o null
 * cuando no hay Range, es multi-rango o es inválido (en ese caso se sirve 200
 * completo). Necesario para que el <video> pueda buscar (seek) y para Safari.
 */
export function parseRangeHeader(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header || !header.startsWith("bytes=") || size <= 0) {
    return null;
  }
  const spec = header.slice("bytes=".length).trim();
  if (spec === "" || spec.includes(",")) {
    return null;
  }
  const dash = spec.indexOf("-");
  if (dash === -1) {
    return null;
  }
  const startStr = spec.slice(0, dash);
  const endStr = spec.slice(dash + 1);

  // Sufijo `bytes=-N`: las últimas N bytes.
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return null;
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return null;
  }
  let end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isInteger(end)) {
    return null;
  }
  end = Math.min(end, size - 1);
  if (end < start) {
    return null;
  }
  return { start, end };
}

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
      return reply.code(400).send({ error: "Adjunta un archivo" });
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
        return reply.code(404).send({ error: "No se encontró la clase" });
      }
      if (!canEditCourse(auth, lesson.course)) {
        return reply.code(403).send({ error: "No tienes acceso a este curso" });
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
      return reply.code(404).send({ error: "No se encontró el archivo" });
    }

    // Resolve the owning course (directly or via the lesson) to authorize.
    const course = asset.course ?? asset.lesson?.course ?? null;
    if (course && !canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
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
      return reply.code(404).send({ error: "No se encontró el archivo" });
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

  // Emite un token corto (15 min) para reproducir un asset en un <video>. Aplica
  // el MISMO candado de acceso que el material del curso: usuario autenticado con
  // acceso al curso dueño. Devuelve una URL lista para pegar en `<video src>`.
  server.get("/assets/:assetId/video-token", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = assetIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const asset = await getPrisma().asset.findUnique({
      where: { id: parsed.data.assetId },
      include: { lesson: true }
    });
    if (!asset) {
      return reply.code(404).send({ error: "No se encontró el archivo" });
    }

    const courseId = asset.courseId ?? asset.lesson?.courseId ?? null;
    if (!(await canAccessCourse(auth, courseId))) {
      return reply.code(403).send({ error: "No tienes acceso a este material" });
    }

    const token = server.jwt.sign(
      { assetId: asset.id, scope: ASSET_STREAM_SCOPE },
      { expiresIn: ASSET_STREAM_TTL }
    );
    const url = `${config.apiPublicUrl}/assets/${asset.id}/stream?token=${encodeURIComponent(token)}`;

    return { token, url, expiresIn: ASSET_STREAM_TTL_SECONDS };
  });

  // Sirve el blob del asset autorizado por el token corto (sin header Authorization,
  // porque el <video> no lo envía). Soporta Range para permitir seek en el player.
  server.get("/assets/:assetId/stream", async (request, reply) => {
    const params = assetIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const query = streamQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(401).send({ error: "Stream token required" });
    }

    let payload: unknown;
    try {
      payload = await server.jwt.verify(query.data.token);
    } catch {
      return reply.code(401).send({ error: "Invalid or expired stream token" });
    }
    if (!assetStreamClaimsValid(payload, params.data.assetId)) {
      return reply.code(403).send({ error: "Stream token does not match this asset" });
    }

    const asset = await getPrisma().asset.findUnique({ where: { id: params.data.assetId } });
    if (!asset) {
      return reply.code(404).send({ error: "No se encontró el archivo" });
    }

    const provider = new LocalStorageProvider(config.localStorageRoot);
    const bytes = await provider.getObject(asset.storageKey);
    const total = bytes.byteLength;
    const contentType = asset.mimeType ?? "application/octet-stream";

    reply.header("accept-ranges", "bytes");
    reply.header("content-type", contentType);
    reply.header("cache-control", "private, max-age=0");

    const range = parseRangeHeader(request.headers.range, total);
    if (range) {
      const chunk = bytes.subarray(range.start, range.end + 1);
      return reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${total}`)
        .header("content-length", String(chunk.byteLength))
        .send(chunk);
    }

    return reply.header("content-length", String(total)).send(bytes);
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
