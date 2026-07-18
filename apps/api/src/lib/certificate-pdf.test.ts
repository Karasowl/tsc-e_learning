import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CERTIFICATE_BACKGROUND_PATH,
  detectImageKind,
  renderCertificatePdf
} from "./certificate-pdf.js";

test("detectImageKind distingue PNG de JPG por los bytes iniciales", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(detectImageKind(png), "png");
  assert.equal(detectImageKind(jpg), "jpg");
  // Formatos desconocidos caen a jpg y el render los degrada a "sin fondo".
  assert.equal(detectImageKind(new Uint8Array([0x00, 0x01])), "jpg");
});

test("renderCertificatePdf usa el fondo de la plantilla cuando backgroundUrl es una ruta legible", async () => {
  const pdf = await renderCertificatePdf(
    {
      id: "cert-3",
      folio: "TSC-20260101-AAAA1111",
      verificationCode: "abc123def456abc123def456",
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      studentName: "ALUMNO DE PRUEBA",
      courseTitle: "Curso con plantilla"
    },
    { template: { backgroundUrl: DEFAULT_CERTIFICATE_BACKGROUND_PATH } }
  );

  assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.ok(pdf.length > 5000, "el fondo debe quedar embebido en el PDF");
});

test("renderCertificatePdf no rompe la descarga si el fondo de la plantilla falla (fail-soft)", async () => {
  const pdf = await renderCertificatePdf(
    {
      id: "cert-4",
      folio: "TSC-20260101-BBBB2222",
      verificationCode: "zzz999yyy888zzz999yyy888",
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      studentName: "ALUMNO DE PRUEBA",
      courseTitle: "Curso con fondo roto"
    },
    { template: { backgroundUrl: "/ruta/que/no/existe.jpg" } }
  );

  // Cae al fondo por defecto y el PDF sigue siendo válido.
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
});

test("renderCertificatePdf produces a valid PDF with bundled assets", async () => {
  const pdf = await renderCertificatePdf({
    id: "cert-1",
    folio: "TSC-20260101-ABCD1234",
    verificationCode: "abc123def456abc123def456",
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    studentName: "MARÍA JOSÉ NÚÑEZ ÁVILA",
    courseTitle: "Manual de Capacitación a Guardias"
  });

  const header = Buffer.from(pdf.slice(0, 5)).toString("latin1");
  assert.equal(header, "%PDF-");
  assert.ok(pdf.length > 5000, "expected a non-trivial PDF (background + fonts embedded)");
});

test("renderCertificatePdf handles long names without throwing", async () => {
  const pdf = await renderCertificatePdf({
    id: "cert-2",
    folio: "TSC-20260101-EEEE5678",
    verificationCode: "zzz999yyy888zzz999yyy888",
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    studentName: "JUAN GUILLERMO FRANCISCO DE LA SANTÍSIMA TRINIDAD HERNÁNDEZ",
    courseTitle: "PARTE DE NOVEDADES Y PARTE INFORMATIVO DETALLADO"
  });

  assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
});
