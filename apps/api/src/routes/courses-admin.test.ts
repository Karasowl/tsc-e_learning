import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLessonCreateData,
  buildLessonUpdateData,
  checkPrerequisiteAddition,
  isUniqueConstraintError
} from "./courses-admin.js";

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
