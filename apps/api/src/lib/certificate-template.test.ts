import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fillCertificatePlaceholders,
  renderCertificateHtml,
  resolveCertificateTemplateBody,
  type CertificateView
} from "./certificates.js";

const view: CertificateView = {
  id: "cert1",
  folio: "TSC-20260717-ABCD1234",
  verificationCode: "abc123def456",
  issuedAt: new Date("2026-07-17T00:00:00Z"),
  studentName: "Juan Pérez",
  courseTitle: "Custodia de Mercancía"
};

describe("resolveCertificateTemplateBody", () => {
  it("devuelve null para valores que no son un objeto de diseño", () => {
    assert.equal(resolveCertificateTemplateBody(null), null);
    assert.equal(resolveCertificateTemplateBody("x"), null);
    assert.equal(resolveCertificateTemplateBody([1, 2]), null);
    assert.equal(resolveCertificateTemplateBody({}), null);
  });

  it("toma solo los campos reconocidos y no vacíos", () => {
    const body = resolveCertificateTemplateBody({
      title: "Certificado",
      legend: "  ",
      backgroundUrl: "https://ej.com/fondo.jpg",
      extra: "ignorado"
    });
    assert.deepEqual(body, { title: "Certificado", backgroundUrl: "https://ej.com/fondo.jpg" });
  });
});

describe("fillCertificatePlaceholders", () => {
  it("sustituye los marcadores por los datos del diploma", () => {
    const out = fillCertificatePlaceholders("{{studentName}} — {{courseTitle}} — {{folio}}", view);
    assert.equal(out, "Juan Pérez — Custodia de Mercancía — TSC-20260717-ABCD1234");
  });
});

describe("renderCertificateHtml con plantilla", () => {
  it("mantiene el diseño por defecto intacto cuando no hay plantilla", () => {
    const html = renderCertificateHtml(view);
    assert.match(html, /DIPLOMADO EN CUSTODIA DE MERCANC/);
    assert.match(html, /Por haber completado satisfactoriamente/);
  });

  it("renderiza el título y la leyenda de la plantilla con marcadores resueltos", () => {
    const template = resolveCertificateTemplateBody({
      title: "Reconocimiento en {{courseTitle}}",
      legend: "Otorgado a {{studentName}}."
    });
    const html = renderCertificateHtml(view, template);
    assert.match(html, /Reconocimiento en Custodia de Mercanc/);
    assert.match(html, /Otorgado a Juan P/);
    // Ya no debe aparecer el título por defecto.
    assert.doesNotMatch(html, /DIPLOMADO EN CUSTODIA/);
  });
});
