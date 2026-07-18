import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { courseDetailAccessWhere, resolveLessonCompletionGate, serializeCourseDetailHeader } from "./courses.js";

describe("serializeCourseDetailHeader (cabecera del detalle de curso)", () => {
  it("expone serviceLine para que el editor del instructor precargue el campo", () => {
    const header = serializeCourseDetailHeader({
      id: "c1",
      title: "Custodia de Mercancía",
      slug: "custodia-de-mercancia",
      description: null,
      excerpt: null,
      status: "PUBLISHED",
      version: 2,
      level: "Básico",
      serviceLine: "Custodia",
      durationSec: 3600
    });

    assert.equal(header.serviceLine, "Custodia");
    assert.equal(header.id, "c1");
    assert.equal(header.version, 2);
  });

  it("conserva serviceLine null cuando el curso no tiene línea de servicio", () => {
    const header = serializeCourseDetailHeader({
      id: "c2",
      title: "T",
      slug: "t",
      description: null,
      excerpt: null,
      status: "DRAFT",
      version: 1,
      level: null,
      serviceLine: null,
      durationSec: null
    });

    assert.equal(header.serviceLine, null);
  });
});

describe("courseDetailAccessWhere (detalle de curso, incluidos archivados del dueño)", () => {
  it("no restringe al admin: puede cargar el detalle de un curso ARCHIVED", () => {
    const where = courseDetailAccessWhere({ userId: "a1", roles: ["ADMIN"] });
    assert.deepEqual(where, {});
  });

  it("permite al docente sus propios cursos en cualquier estado, y los ajenos solo inscrito y no archivados", () => {
    const where = courseDetailAccessWhere({ userId: "t1", roles: ["TEACHER"] });
    assert.deepEqual(where, {
      OR: [
        { teacherId: "t1" },
        {
          status: { not: "ARCHIVED" },
          enrollments: { some: { userId: "t1" } }
        }
      ]
    });
  });

  it("mantiene al estudiante en cursos PUBLISHED donde está inscrito (sin archivados ni borradores)", () => {
    const where = courseDetailAccessWhere({ userId: "s1", roles: ["STUDENT"] });
    assert.deepEqual(where, {
      status: "PUBLISHED",
      enrollments: { some: { userId: "s1" } }
    });
  });
});

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
