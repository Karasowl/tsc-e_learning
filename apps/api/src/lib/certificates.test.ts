import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  certificateFolio,
  certificateStorageKey,
  certificateVerificationCode,
  renderCertificateHtml
} from "./certificates.js";

describe("certificates", () => {
  it("creates stable printable certificate fields", () => {
    const issuedAt = new Date("2026-06-03T12:00:00.000Z");
    const folio = certificateFolio("user-1", "course-1", issuedAt);
    const verification = certificateVerificationCode("user-1", "course-1", issuedAt);

    assert.match(folio, /^TSC-20260603-[A-F0-9]{8}$/);
    assert.equal(verification.length, 24);
    assert.equal(certificateStorageKey(folio), `certificates/generated-on-demand/${folio}.pdf`);
  });

  it("escapes certificate HTML content", () => {
    const html = renderCertificateHtml({
      id: "cert",
      folio: "folio",
      verificationCode: "verify",
      issuedAt: new Date("2026-06-03T12:00:00.000Z"),
      studentName: "Alumno <script>",
      courseTitle: "Curso & Seguridad"
    });

    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("Alumno &lt;script&gt;"), true);
    assert.equal(html.includes("Curso &amp; Seguridad"), true);
  });
});
