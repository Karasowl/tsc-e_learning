import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCertificatePdf } from "./certificate-pdf.js";

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
