import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canReadCertificateTemplates, serializeTemplate } from "./certificate-templates.js";

describe("canReadCertificateTemplates (lectura del catálogo de plantillas)", () => {
  it("permite la lectura a un docente (necesita listar para vincular a su curso)", () => {
    assert.equal(canReadCertificateTemplates({ userId: "t1", roles: ["TEACHER"] }), true);
  });

  it("permite la lectura a un admin", () => {
    assert.equal(canReadCertificateTemplates({ userId: "a1", roles: ["ADMIN"] }), true);
  });

  it("niega la lectura a un estudiante", () => {
    assert.equal(canReadCertificateTemplates({ userId: "s1", roles: ["STUDENT"] }), false);
  });
});

describe("serializeTemplate", () => {
  it("expone los courseIds vinculados y conserva el diseño (body)", () => {
    const now = new Date();
    const row = serializeTemplate({
      id: "t1",
      name: "Diploma azul",
      body: { title: "Certificado", legend: "Texto" },
      createdAt: now,
      updatedAt: now,
      courseLinks: [{ courseId: "c1" }, { courseId: "c2" }]
    });

    assert.deepEqual(row.courseIds, ["c1", "c2"]);
    assert.deepEqual(row.body, { title: "Certificado", legend: "Texto" });
    assert.equal(row.name, "Diploma azul");
  });

  it("devuelve courseIds vacío cuando la plantilla no está vinculada a ningún curso", () => {
    const now = new Date();
    const row = serializeTemplate({
      id: "t2",
      name: "Sin vincular",
      body: {},
      createdAt: now,
      updatedAt: now
    });
    assert.deepEqual(row.courseIds, []);
  });
});
