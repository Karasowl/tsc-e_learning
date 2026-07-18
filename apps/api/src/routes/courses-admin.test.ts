import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  buildCourseUpdateData,
  buildLessonCreateData,
  buildLessonUpdateData,
  checkPrerequisiteAddition,
  cleanupAssets,
  isUniqueConstraintError
} from "./courses-admin.js";

// Fake mínimo para cleanupAssets: cursos vivos con su portada, y registro de qué
// filas y blobs se borran.
function makeCleanupFakes(courses: Array<{ id: string; thumbnailAssetId: string | null }>) {
  const deletedAssetIds: string[] = [];
  const deletedBlobs: string[] = [];
  const prisma = {
    course: {
      findMany: async ({
        where
      }: {
        where: { thumbnailAssetId: { in: string[] }; id?: { not: string } };
      }) =>
        courses
          .filter(
            (course) =>
              course.thumbnailAssetId !== null && where.thumbnailAssetId.in.includes(course.thumbnailAssetId)
          )
          .filter((course) => (where.id ? course.id !== where.id.not : true))
          .map((course) => ({ thumbnailAssetId: course.thumbnailAssetId }))
    },
    asset: {
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        deletedAssetIds.push(...where.id.in);
        return { count: where.id.in.length };
      }
    }
  } as unknown as PrismaClient;

  return {
    deletedAssetIds,
    deletedBlobs,
    deps: {
      prisma,
      deleteBlob: async (storageKey: string) => {
        deletedBlobs.push(storageKey);
      },
      logger: { warn: () => {} }
    }
  };
}

describe("cleanupAssets (limpieza de blobs al borrar curso/clase)", () => {
  it("al borrar una CLASE conserva un material que además es portada de su propio curso vivo", async () => {
    const { deps, deletedAssetIds, deletedBlobs } = makeCleanupFakes([{ id: "c1", thumbnailAssetId: "a1" }]);

    // deletedCourseId null: nadie se excluye del chequeo, el curso c1 sigue vivo.
    await cleanupAssets([{ id: "a1", storageKey: "k1" }], null, deps);

    assert.deepEqual(deletedAssetIds, []);
    assert.deepEqual(deletedBlobs, []);
  });

  it("al borrar el CURSO ese mismo asset sí se limpia (el curso dueño ya no existe)", async () => {
    const { deps, deletedAssetIds, deletedBlobs } = makeCleanupFakes([{ id: "c1", thumbnailAssetId: "a1" }]);

    await cleanupAssets([{ id: "a1", storageKey: "k1" }], "c1", deps);

    assert.deepEqual(deletedAssetIds, ["a1"]);
    assert.deepEqual(deletedBlobs, ["k1"]);
  });

  it("al borrar una CLASE limpia los materiales que no son portada de nadie", async () => {
    const { deps, deletedAssetIds, deletedBlobs } = makeCleanupFakes([{ id: "c1", thumbnailAssetId: "otro" }]);

    await cleanupAssets([{ id: "a2", storageKey: "k2" }], null, deps);

    assert.deepEqual(deletedAssetIds, ["a2"]);
    assert.deepEqual(deletedBlobs, ["k2"]);
  });

  it("conserva una portada reutilizada por OTRO curso al borrar un curso", async () => {
    const { deps, deletedAssetIds } = makeCleanupFakes([
      { id: "c1", thumbnailAssetId: "a1" },
      { id: "c2", thumbnailAssetId: "a1" }
    ]);

    await cleanupAssets([{ id: "a1", storageKey: "k1" }], "c1", deps);

    assert.deepEqual(deletedAssetIds, []);
  });
});

describe("buildCourseUpdateData (edición de curso)", () => {
  const draftCourse = { status: "DRAFT", publishedAt: null };

  it("acepta serviceLine al editar (no solo al crear)", () => {
    const data = buildCourseUpdateData({ serviceLine: "Custodia" }, draftCourse, false);
    assert.equal(data.serviceLine, "Custodia");
  });

  it("acepta serviceLine null para limpiar la línea de servicio", () => {
    const data = buildCourseUpdateData({ serviceLine: null }, draftCourse, false);
    assert.equal(data.serviceLine, null);
  });

  it("no toca serviceLine cuando no viene en el cuerpo", () => {
    const data = buildCourseUpdateData({ title: "Nuevo título" }, draftCourse, false);
    assert.equal("serviceLine" in data, false);
    assert.equal(data.title, "Nuevo título");
  });

  it("corta versión (vN→vN+1) al publicar desde borrador", () => {
    const data = buildCourseUpdateData({ status: "PUBLISHED" }, draftCourse, false);
    assert.deepEqual(data.version, { increment: 1 });
    assert.ok(data.publishedAt instanceof Date);
  });

  it("no corta versión cuando el curso ya estaba publicado", () => {
    const data = buildCourseUpdateData(
      { status: "PUBLISHED" },
      { status: "PUBLISHED", publishedAt: new Date("2026-01-01T00:00:00Z") },
      false
    );
    assert.equal("version" in data, false);
  });

  it("solo el admin puede reasignar el docente", () => {
    const asTeacher = buildCourseUpdateData({ teacherId: "t2" }, draftCourse, false);
    assert.equal("teacher" in asTeacher, false);
    const asAdmin = buildCourseUpdateData({ teacherId: "t2" }, draftCourse, true);
    assert.deepEqual(asAdmin.teacher, { connect: { id: "t2" } });
  });
});

describe("buildLessonCreateData (persistencia de campos de lección)", () => {
  it("persiste durationSec y kind cuando llegan en el cuerpo", () => {
    const data = buildLessonCreateData(
      { title: "Custodia física", kind: "VIDEO", durationSec: 320 },
      { courseId: "c1", slug: "custodia-fisica", position: 1, videoProvider: "youtube" }
    );
    assert.equal(data.kind, "VIDEO");
    assert.equal(data.durationSec, 320);
    assert.equal(data.videoProvider, "youtube");
    assert.equal(data.courseId, "c1");
    assert.equal(data.position, 1);
  });

  it("usa MIXED por defecto y omite durationSec cuando no se envían", () => {
    const data = buildLessonCreateData(
      { title: "Sin metadatos" },
      { courseId: "c1", slug: "sin-metadatos", position: 2, videoProvider: undefined }
    );
    assert.equal(data.kind, "MIXED");
    assert.equal("durationSec" in data, false);
  });
});

describe("buildLessonUpdateData (persistencia en edición)", () => {
  it("persiste durationSec y kind en un update parcial", () => {
    const data = buildLessonUpdateData({ kind: "RESOURCE", durationSec: 45 });
    assert.equal(data.kind, "RESOURCE");
    assert.equal(data.durationSec, 45);
    assert.equal("title" in data, false);
  });

  it("permite limpiar la duración con null", () => {
    const data = buildLessonUpdateData({ durationSec: null });
    assert.equal(data.durationSec, null);
  });

  it("no toca durationSec ni kind si no vienen en el cuerpo", () => {
    const data = buildLessonUpdateData({ title: "Solo título" });
    assert.equal("durationSec" in data, false);
    assert.equal("kind" in data, false);
    assert.equal(data.title, "Solo título");
  });
});

describe("checkPrerequisiteAddition (integridad del grafo de prerrequisitos)", () => {
  it("acepta un prerrequisito nuevo válido (prereq creado)", () => {
    const result = checkPrerequisiteAddition("B", "A", []);
    assert.deepEqual(result, { ok: true });
  });

  it("rechaza el auto-prerrequisito (self)", () => {
    const result = checkPrerequisiteAddition("A", "A", []);
    assert.deepEqual(result, { ok: false, reason: "self" });
  });

  it("rechaza el ciclo directo A→B, intentar B→A", () => {
    // A ya requiere B. Añadir B→A cerraría el ciclo.
    const edges = [{ courseId: "A", requiresId: "B" }];
    const result = checkPrerequisiteAddition("B", "A", edges);
    assert.deepEqual(result, { ok: false, reason: "cycle" });
  });

  it("rechaza el ciclo transitivo A→B, B→C, intentar C→A", () => {
    const edges = [
      { courseId: "A", requiresId: "B" },
      { courseId: "B", requiresId: "C" }
    ];
    const result = checkPrerequisiteAddition("C", "A", edges);
    assert.deepEqual(result, { ok: false, reason: "cycle" });
  });

  it("acepta una arista que no cierra ciclo en un grafo con dependencias", () => {
    const edges = [
      { courseId: "A", requiresId: "B" },
      { courseId: "B", requiresId: "C" }
    ];
    // A requiere D: D no depende de nada, no hay ciclo.
    const result = checkPrerequisiteAddition("A", "D", edges);
    assert.deepEqual(result, { ok: true });
  });
});

describe("isUniqueConstraintError (idempotencia del vínculo)", () => {
  it("reconoce el código P2002 de Prisma", () => {
    assert.equal(isUniqueConstraintError({ code: "P2002" }), true);
  });

  it("no confunde otros errores", () => {
    assert.equal(isUniqueConstraintError({ code: "P2025" }), false);
    assert.equal(isUniqueConstraintError(new Error("boom")), false);
    assert.equal(isUniqueConstraintError(null), false);
    assert.equal(isUniqueConstraintError(undefined), false);
  });
});
