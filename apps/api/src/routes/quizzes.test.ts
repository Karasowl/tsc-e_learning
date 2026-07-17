import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveExamStartGate } from "./quizzes.js";

describe("resolveExamStartGate (bloqueo duro al iniciar examen)", () => {
  it("rechaza cuando el curso esta bloqueado por prerrequisito", () => {
    const gate = resolveExamStartGate({
      prerequisites: [{ requiresId: "c-basico", requiresTitle: "Curso Basico" }],
      completedCourseIds: new Set<string>(),
      totalLessons: 3,
      completedLessons: 3
    });
    assert.equal(gate.allowed, false);
    assert.equal(
      gate.message,
      'Este curso está bloqueado: Completa antes el curso "Curso Basico" para desbloquear este.'
    );
  });

  it("rechaza cuando faltan lecciones por completar (examen bloqueado)", () => {
    const gate = resolveExamStartGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      totalLessons: 3,
      completedLessons: 1
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.message, "Completa todas las lecciones antes de presentar el examen.");
  });

  it("permite presentar el examen con todas las lecciones completas y sin prereqs (camino feliz)", () => {
    const gate = resolveExamStartGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      totalLessons: 3,
      completedLessons: 3
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.message, undefined);
  });

  it("permite el examen de un curso sin lecciones (nada que exigir)", () => {
    const gate = resolveExamStartGate({
      prerequisites: [],
      completedCourseIds: new Set<string>(),
      totalLessons: 0,
      completedLessons: 0
    });
    assert.equal(gate.allowed, true);
  });

  it("prioriza el prerrequisito sobre las lecciones incompletas", () => {
    const gate = resolveExamStartGate({
      prerequisites: [{ requiresId: "c-basico", requiresTitle: "Curso Basico" }],
      completedCourseIds: new Set<string>(),
      totalLessons: 3,
      completedLessons: 0
    });
    assert.equal(gate.allowed, false);
    assert.ok(gate.message?.startsWith("Este curso está bloqueado:"));
  });

  it("permite el examen cuando el prereq esta cumplido y las lecciones completas", () => {
    const gate = resolveExamStartGate({
      prerequisites: [{ requiresId: "c-basico", requiresTitle: "Curso Basico" }],
      completedCourseIds: new Set(["c-basico"]),
      totalLessons: 2,
      completedLessons: 2
    });
    assert.equal(gate.allowed, true);
  });
});
