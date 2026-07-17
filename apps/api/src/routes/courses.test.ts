import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLessonCompletionGate } from "./courses.js";

describe("resolveLessonCompletionGate (bloqueo duro al completar leccion)", () => {
  it("rechaza cuando el curso esta bloqueado por un prerrequisito no completado", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [{ requiresId: "c-basico", requiresTitle: "Curso Basico" }],
      completedCourseIds: new Set<string>(),
      orderedLessons: [{ id: "l1", completed: false }],
      targetLessonId: "l1"
    });
    assert.equal(gate.allowed, false);
    assert.equal(
      gate.message,
      'Este curso está bloqueado: Completa antes el curso "Curso Basico" para desbloquear este.'
    );
  });

  it("rechaza una leccion no-primera cuando las anteriores no estan completas (secuencial)", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      orderedLessons: [
        { id: "l1", completed: false },
        { id: "l2", completed: false },
        { id: "l3", completed: false }
      ],
      targetLessonId: "l2"
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.message, "Completa las lecciones anteriores antes de esta.");
  });

  it("permite la primera leccion aunque nada este completo (camino feliz de arranque)", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      orderedLessons: [
        { id: "l1", completed: false },
        { id: "l2", completed: false }
      ],
      targetLessonId: "l1"
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.message, undefined);
  });

  it("permite la siguiente leccion cuando la anterior ya esta completa y el prereq se cumplio", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [{ requiresId: "c-basico", requiresTitle: "Curso Basico" }],
      completedCourseIds: new Set(["c-basico"]),
      orderedLessons: [
        { id: "l1", completed: true },
        { id: "l2", completed: false }
      ],
      targetLessonId: "l2"
    });
    assert.equal(gate.allowed, true);
  });

  it("permite re-completar una leccion ya disponible (idempotente)", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      orderedLessons: [
        { id: "l1", completed: true },
        { id: "l2", completed: true }
      ],
      targetLessonId: "l2"
    });
    assert.equal(gate.allowed, true);
  });

  it("no bloquea una leccion fuera del orden secuencial (por ejemplo sin modulo): se permite", () => {
    const gate = resolveLessonCompletionGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      orderedLessons: [{ id: "l1", completed: false }],
      targetLessonId: "leccion-suelta"
    });
    assert.equal(gate.allowed, true);
  });
});
