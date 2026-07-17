import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCourseLock,
  computeExamLocked,
  computeSequentialLessons,
  computeStreak,
  isEnrollmentExpired
} from "./gating.js";

// ---------------------------------------------------------------------------
// computeCourseLock: candado por prerrequisitos de curso
// ---------------------------------------------------------------------------
describe("computeCourseLock", () => {
  it("sin prerrequisitos => desbloqueado", () => {
    const result = computeCourseLock([], new Set<string>());
    assert.equal(result.locked, false);
    assert.equal(result.lockReason, null);
  });

  it("prereq no completado => bloqueado, con el titulo en la razon", () => {
    const result = computeCourseLock(
      [{ requiresId: "c-prot", requiresTitle: "Proteccion Ejecutiva" }],
      new Set<string>()
    );
    assert.equal(result.locked, true);
    assert.match(result.lockReason ?? "", /Proteccion Ejecutiva/);
  });

  it("prereq completado => desbloqueado", () => {
    const result = computeCourseLock(
      [{ requiresId: "c-prot", requiresTitle: "Proteccion Ejecutiva" }],
      new Set<string>(["c-prot"])
    );
    assert.equal(result.locked, false);
    assert.equal(result.lockReason, null);
  });

  it("varios prereqs, algunos faltantes => bloqueado y lista solo los faltantes", () => {
    const result = computeCourseLock(
      [
        { requiresId: "c-a", requiresTitle: "Curso A" },
        { requiresId: "c-b", requiresTitle: "Curso B" }
      ],
      new Set<string>(["c-a"])
    );
    assert.equal(result.locked, true);
    assert.match(result.lockReason ?? "", /Curso B/);
    assert.doesNotMatch(result.lockReason ?? "", /Curso A/);
  });

  it("todos los prereqs completados => desbloqueado", () => {
    const result = computeCourseLock(
      [
        { requiresId: "c-a", requiresTitle: "Curso A" },
        { requiresId: "c-b", requiresTitle: "Curso B" }
      ],
      new Set<string>(["c-a", "c-b"])
    );
    assert.equal(result.locked, false);
  });
});

// ---------------------------------------------------------------------------
// computeSequentialLessons: bloqueo secuencial de lecciones
// ---------------------------------------------------------------------------
describe("computeSequentialLessons", () => {
  it("la primera leccion siempre esta disponible", () => {
    const out = computeSequentialLessons([
      { id: "l1", completed: false },
      { id: "l2", completed: false }
    ]);
    assert.equal(out[0]!.available, true);
    assert.equal(out[0]!.locked, false);
  });

  it("la siguiente se bloquea si la anterior no esta completa", () => {
    const out = computeSequentialLessons([
      { id: "l1", completed: false },
      { id: "l2", completed: false }
    ]);
    assert.equal(out[1]!.available, false);
    assert.equal(out[1]!.locked, true);
  });

  it("se desbloquea en cadena a medida que se completan las anteriores", () => {
    const out = computeSequentialLessons([
      { id: "l1", completed: true },
      { id: "l2", completed: true },
      { id: "l3", completed: false }
    ]);
    assert.equal(out[0]!.available, true);
    assert.equal(out[1]!.available, true);
    assert.equal(out[2]!.available, true); // disponible porque las 2 anteriores estan completas
  });

  it("un hueco bloquea todo lo posterior aunque este completado mas adelante", () => {
    const out = computeSequentialLessons([
      { id: "l1", completed: true },
      { id: "l2", completed: false }, // hueco
      { id: "l3", completed: true }
    ]);
    assert.equal(out[1]!.available, true); // l2 disponible (l1 completa)
    assert.equal(out[2]!.available, false); // l3 bloqueada (l2 incompleta)
    assert.equal(out[2]!.locked, true);
  });

  it("lista vacia => arreglo vacio", () => {
    assert.deepEqual(computeSequentialLessons([]), []);
  });
});

// ---------------------------------------------------------------------------
// computeExamLocked: candado del examen
// ---------------------------------------------------------------------------
describe("computeExamLocked", () => {
  it("todas las lecciones completas => examen desbloqueado", () => {
    assert.equal(computeExamLocked(3, 3), false);
  });

  it("faltan lecciones => examen bloqueado", () => {
    assert.equal(computeExamLocked(3, 2), true);
  });

  it("ninguna completa => examen bloqueado", () => {
    assert.equal(computeExamLocked(3, 0), true);
  });

  it("curso sin lecciones => examen desbloqueado (nada que exigir)", () => {
    assert.equal(computeExamLocked(0, 0), false);
  });
});

// ---------------------------------------------------------------------------
// isEnrollmentExpired: vencimiento de inscripcion
// ---------------------------------------------------------------------------
describe("isEnrollmentExpired", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");

  it("sin fecha de expiracion => no vencida", () => {
    assert.equal(isEnrollmentExpired(null, now), false);
    assert.equal(isEnrollmentExpired(undefined, now), false);
  });

  it("expiracion en el futuro => no vencida", () => {
    assert.equal(isEnrollmentExpired(new Date("2026-08-01T00:00:00.000Z"), now), false);
  });

  it("expiracion en el pasado => vencida", () => {
    assert.equal(isEnrollmentExpired(new Date("2026-07-01T00:00:00.000Z"), now), true);
  });
});

// ---------------------------------------------------------------------------
// computeStreak: racha diaria (null / hoy / ayer / hueco)
// ---------------------------------------------------------------------------
describe("computeStreak", () => {
  // Fechas construidas en hora LOCAL (new Date(anio, mesBase0, dia, hora)) para
  // que la comparacion por dia-calendario (tambien local) sea determinista en
  // cualquier zona horaria de la maquina de pruebas.
  it("sin actividad previa (null) => racha 1 y cambia", () => {
    const now = new Date(2026, 6, 17, 12);
    const result = computeStreak({ lastActiveDate: null, currentStreak: 0, now });
    assert.equal(result.currentStreak, 1);
    assert.equal(result.changed, true);
    assert.equal(result.lastActiveDate, now);
  });

  it("actividad hoy (mismo dia) => sin cambio", () => {
    const now = new Date(2026, 6, 17, 20);
    const last = new Date(2026, 6, 17, 8);
    const result = computeStreak({ lastActiveDate: last, currentStreak: 5, now });
    assert.equal(result.currentStreak, 5);
    assert.equal(result.changed, false);
  });

  it("actividad ayer => racha + 1", () => {
    const now = new Date(2026, 6, 17, 9);
    const last = new Date(2026, 6, 16, 22);
    const result = computeStreak({ lastActiveDate: last, currentStreak: 3, now });
    assert.equal(result.currentStreak, 4);
    assert.equal(result.changed, true);
    assert.equal(result.lastActiveDate, now);
  });

  it("hueco de dos o mas dias => racha se reinicia a 1", () => {
    const now = new Date(2026, 6, 17, 9);
    const last = new Date(2026, 6, 14, 9);
    const result = computeStreak({ lastActiveDate: last, currentStreak: 8, now });
    assert.equal(result.currentStreak, 1);
    assert.equal(result.changed, true);
  });

  it("fecha previa en el futuro (reloj movido) => reinicia a 1 sin romperse", () => {
    const now = new Date(2026, 6, 17, 9);
    const last = new Date(2026, 6, 20, 9);
    const result = computeStreak({ lastActiveDate: last, currentStreak: 8, now });
    assert.equal(result.currentStreak, 1);
    assert.equal(result.changed, true);
  });
});
