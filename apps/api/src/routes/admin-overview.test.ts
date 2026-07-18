import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCompliance,
  computeGovernanceAlert,
  type ComplianceEnrollment
} from "./admin-overview.js";

// ---------------------------------------------------------------------------
// aggregateCompliance: agrupación de cumplimiento por línea y por sede
// ---------------------------------------------------------------------------
describe("aggregateCompliance", () => {
  it("sin inscripciones => grupos vacíos", () => {
    const result = aggregateCompliance([]);
    assert.deepEqual(result, { byLine: [], bySite: [] });
  });

  it("cuenta total, completadas y pct redondeado por línea y por sede", () => {
    const enrollments: ComplianceEnrollment[] = [
      { line: "Protección ejecutiva", site: "Sede Norte", completed: true },
      { line: "Protección ejecutiva", site: "Sede Norte", completed: false },
      { line: "Protección ejecutiva", site: "Sede Sur", completed: true }
    ];

    const result = aggregateCompliance(enrollments);

    // Una sola línea: 3 inscripciones, 2 completadas => 67% (redondeo de 66.67).
    assert.deepEqual(result.byLine, [
      { line: "Protección ejecutiva", total: 3, completed: 2, pct: 67 }
    ]);

    // Dos sedes: Norte 2/1 => 50%, Sur 1/1 => 100%. Orden alfabético.
    assert.deepEqual(result.bySite, [
      { site: "Sede Norte", total: 2, completed: 1, pct: 50 },
      { site: "Sede Sur", total: 1, completed: 1, pct: 100 }
    ]);
  });

  it("línea/sede nula cae en 'Sin línea'/'Sin sede'", () => {
    const enrollments: ComplianceEnrollment[] = [
      { line: null, site: null, completed: true },
      { line: null, site: null, completed: false }
    ];

    const result = aggregateCompliance(enrollments);

    assert.deepEqual(result.byLine, [{ line: "Sin línea", total: 2, completed: 1, pct: 50 }]);
    assert.deepEqual(result.bySite, [{ site: "Sin sede", total: 2, completed: 1, pct: 50 }]);
  });

  it("EXPIRED (completed=false) cuenta como no completada", () => {
    // Modela una inscripción vencida: la ruta pasa completed=false para todo lo que
    // no sea COMPLETED, así que aquí llega como no completada.
    const enrollments: ComplianceEnrollment[] = [
      { line: "Custodia de mercancía", site: "Sede Norte", completed: true },
      { line: "Custodia de mercancía", site: "Sede Norte", completed: false } // EXPIRED
    ];

    const result = aggregateCompliance(enrollments);

    assert.deepEqual(result.byLine, [
      { line: "Custodia de mercancía", total: 2, completed: 1, pct: 50 }
    ]);
  });

  it("pct es 0 cuando el grupo no tiene ninguna completada", () => {
    const result = aggregateCompliance([{ line: "L", site: "S", completed: false }]);
    assert.equal(result.byLine[0]!.pct, 0);
    assert.equal(result.bySite[0]!.pct, 0);
  });

  it("ordena los grupos alfabéticamente por etiqueta", () => {
    const enrollments: ComplianceEnrollment[] = [
      { line: "Zeta", site: "z", completed: true },
      { line: "Alfa", site: "a", completed: true }
    ];
    const result = aggregateCompliance(enrollments);
    assert.deepEqual(result.byLine.map((row) => row.line), ["Alfa", "Zeta"]);
  });
});

// ---------------------------------------------------------------------------
// computeGovernanceAlert: la alerta única de gobierno (más severa) o null
// ---------------------------------------------------------------------------
describe("computeGovernanceAlert", () => {
  const clear: Parameters<typeof computeGovernanceAlert>[0] = {
    expiredEnrollments: 0,
    pendingNotifications: 0,
    smtpConfigured: true,
    publishedCoursesWithoutTeacher: 0
  };

  it("todo en orden => null", () => {
    assert.equal(computeGovernanceAlert(clear), null);
  });

  it("correo encolado sin SMTP configurado => critical", () => {
    const alert = computeGovernanceAlert({ ...clear, pendingNotifications: 3, smtpConfigured: false });
    assert.equal(alert?.level, "critical");
    assert.match(alert?.detail ?? "", /3/);
  });

  it("correo encolado pero SMTP configurado => no dispara critical", () => {
    const alert = computeGovernanceAlert({ ...clear, pendingNotifications: 3, smtpConfigured: true });
    assert.equal(alert, null);
  });

  it("inscripciones vencidas => warn", () => {
    const alert = computeGovernanceAlert({ ...clear, expiredEnrollments: 2 });
    assert.equal(alert?.level, "warn");
    assert.match(alert?.title ?? "", /vencidas/i);
  });

  it("cursos publicados sin instructor => warn", () => {
    const alert = computeGovernanceAlert({ ...clear, publishedCoursesWithoutTeacher: 1 });
    assert.equal(alert?.level, "warn");
    assert.match(alert?.title ?? "", /instructor/i);
  });

  it("prioridad: critical (correo) gana sobre warn (vencidas) cuando ambas aplican", () => {
    const alert = computeGovernanceAlert({
      expiredEnrollments: 5,
      pendingNotifications: 4,
      smtpConfigured: false,
      publishedCoursesWithoutTeacher: 2
    });
    assert.equal(alert?.level, "critical");
  });

  it("singular/plural: una sola inscripción vencida usa el singular", () => {
    const alert = computeGovernanceAlert({ ...clear, expiredEnrollments: 1 });
    assert.match(alert?.detail ?? "", /1 inscripción vencida/);
  });
});
