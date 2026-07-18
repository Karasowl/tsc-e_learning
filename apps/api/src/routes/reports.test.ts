import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterStudentReport, type StudentReport, type StudentReportRow } from "./reports.js";

// Fila mínima con los campos que usa el filtro; el resto del shape del reporte
// no participa en la búsqueda.
function row(overrides: Partial<StudentReportRow>): StudentReportRow {
  return {
    studentName: "Juan Pérez",
    email: "juan@tsc.com.mx",
    serviceLabel: "Turno A",
    courseTitle: "Custodia de Mercancía",
    status: "En Progreso",
    ...overrides
  } as StudentReportRow;
}

function reportWith(rows: StudentReportRow[]): StudentReport {
  return { summary: {}, rows } as unknown as StudentReport;
}

describe("filterStudentReport (el Excel respeta la búsqueda de la pantalla)", () => {
  it("filtra por nombre, correo, servicio o curso, sin distinguir mayúsculas", () => {
    const report = reportWith([
      row({ studentName: "Ana López", email: "ana@tsc.com.mx" }),
      row({ studentName: "Juan Pérez", serviceLabel: "Custodia Nocturna" }),
      row({ studentName: "Pedro Gil", courseTitle: "Primeros Auxilios" })
    ]);

    assert.equal(filterStudentReport(report, "ANA").rows.length, 1);
    assert.equal(filterStudentReport(report, "nocturna").rows.length, 1);
    assert.equal(filterStudentReport(report, "auxilios").rows.length, 1);
    assert.equal(filterStudentReport(report, "tsc.com.mx").rows.length, 3);
  });

  it("sin término devuelve el reporte intacto", () => {
    const report = reportWith([row({}), row({ studentName: "Otra Persona" })]);
    assert.equal(filterStudentReport(report, undefined), report);
    assert.equal(filterStudentReport(report, "   "), report);
  });

  it("recalcula el resumen sobre las filas filtradas", () => {
    const report = reportWith([
      row({ studentName: "Ana", status: "Aprobado" }),
      row({ studentName: "Juan", status: "Reprobado" })
    ]);
    const filtered = filterStudentReport(report, "ana");
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.summary["Aprobado"], 1);
    assert.equal(filtered.summary["Reprobado"], 0);
  });

  it("tolera serviceLabel null (colaboradores sin servicio)", () => {
    const report = reportWith([row({ serviceLabel: null })]);
    assert.equal(filterStudentReport(report, "turno").rows.length, 0);
  });

  it("filtra por estado del veredicto con igualdad exacta (como la pantalla del instructor)", () => {
    const report = reportWith([
      row({ studentName: "Ana", status: "Aprobado" }),
      row({ studentName: "Juan", status: "Reprobado" }),
      row({ studentName: "Pedro", status: "En Progreso" })
    ]);

    const filtered = filterStudentReport(report, undefined, "Aprobado");
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0]!.studentName, "Ana");
    assert.equal(filtered.summary["Aprobado"], 1);
    assert.equal(filtered.summary["Reprobado"], 0);
  });

  it("combina búsqueda y estado: ambos deben cumplirse", () => {
    const report = reportWith([
      row({ studentName: "Ana López", status: "Aprobado" }),
      row({ studentName: "Ana Ruiz", status: "Reprobado" }),
      row({ studentName: "Juan Pérez", status: "Aprobado" })
    ]);

    const filtered = filterStudentReport(report, "ana", "Aprobado");
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0]!.studentName, "Ana López");
  });

  it("con solo estado (sin q) también filtra", () => {
    const report = reportWith([
      row({ status: "Pendiente" }),
      row({ studentName: "Otro", status: "Aprobado" })
    ]);
    assert.equal(filterStudentReport(report, undefined, "Pendiente").rows.length, 1);
  });
});
