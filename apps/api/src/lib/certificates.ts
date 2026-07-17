import { createHash } from "node:crypto";

export type CertificateView = {
  id: string;
  folio: string;
  verificationCode: string;
  issuedAt: Date;
  studentName: string;
  courseTitle: string;
  backgroundUrl?: string;
};

/**
 * Diseño editable de una plantilla de certificado. Se guarda como JSON en
 * `CertificateTemplate.body`. Los campos ausentes caen al diseño por defecto, de
 * modo que un curso sin plantilla vinculada conserva el diploma actual intacto.
 * Los textos admiten los marcadores {{courseTitle}}, {{studentName}}, {{folio}},
 * {{verificationCode}} y {{issuedAt}}.
 */
export type CertificateTemplateBody = {
  title?: string;
  legend?: string;
  backgroundUrl?: string;
};

/**
 * Lee de forma segura un `body` JSON arbitrario (Prisma.JsonValue) y devuelve
 * solo los campos de plantilla reconocidos y no vacíos, o null si no hay ninguno
 * (para que el emisor use el diseño por defecto sin ramas especiales).
 */
export function resolveCertificateTemplateBody(body: unknown): CertificateTemplateBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const result: CertificateTemplateBody = {};
  if (typeof record.title === "string" && record.title.trim().length > 0) {
    result.title = record.title;
  }
  if (typeof record.legend === "string" && record.legend.trim().length > 0) {
    result.legend = record.legend;
  }
  if (typeof record.backgroundUrl === "string" && record.backgroundUrl.trim().length > 0) {
    result.backgroundUrl = record.backgroundUrl;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Sustituye los marcadores {{...}} de una plantilla por los datos del diploma. */
export function fillCertificatePlaceholders(text: string, view: CertificateView): string {
  return text
    .replaceAll("{{courseTitle}}", view.courseTitle)
    .replaceAll("{{studentName}}", view.studentName)
    .replaceAll("{{folio}}", view.folio)
    .replaceAll("{{verificationCode}}", view.verificationCode)
    .replaceAll("{{issuedAt}}", formatDate(view.issuedAt));
}

export function certificateFolio(userId: string, courseId: string, issuedAt = new Date()) {
  const date = issuedAt.toISOString().slice(0, 10).replaceAll("-", "");
  const hash = createHash("sha256").update(`${userId}:${courseId}:${date}`).digest("hex").slice(0, 8).toUpperCase();
  return `TSC-${date}-${hash}`;
}

export function certificateVerificationCode(userId: string, courseId: string, issuedAt = new Date()) {
  return createHash("sha256")
    .update(`tsc-certificate:${userId}:${courseId}:${issuedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24);
}

export function certificateStorageKey(folio: string) {
  return `certificates/generated-on-demand/${folio}.pdf`;
}

export function renderCertificateHtml(view: CertificateView, template?: CertificateTemplateBody | null) {
  const backgroundUrl = template?.backgroundUrl ?? view.backgroundUrl;
  const background = backgroundUrl
    ? `background-image:url('${escapeAttribute(backgroundUrl)}');background-size:cover;background-repeat:no-repeat;`
    : "background:#fff;border:8px solid #8B1A1A;";

  // El diseño por defecto se conserva byte a byte cuando no hay plantilla.
  const titleHtml = template?.title
    ? escapeHtml(fillCertificatePlaceholders(template.title, view))
    : `DIPLOMADO EN ${escapeHtml(view.courseTitle).toUpperCase()}`;
  const legendHtml = template?.legend
    ? escapeHtml(fillCertificatePlaceholders(template.legend, view))
    : `Por haber completado satisfactoriamente el programa de capacitación especializada en <strong>${escapeHtml(view.courseTitle)}</strong>, demostrando las competencias y conocimientos necesarios para implementar estrategias efectivas de administración del personal en el sector de seguridad privada.`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diploma ${escapeHtml(view.studentName)}</title>
<style>
@page{size:279.4mm 215.9mm;margin:0}
html,body{margin:0;padding:0;width:279.4mm;height:215.9mm;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4}
#diploma{position:relative;width:279.4mm;height:215.9mm;margin:0 auto;overflow:hidden;${background}}
.title{position:absolute;top:26%;left:50%;transform:translate(-50%,-50%);font-size:18px;font-weight:700;color:#8B1A1A;text-transform:uppercase;white-space:nowrap}
.name{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font-size:48px;font-family:"Brush Script MT",cursive,Georgia;color:#3d1f0f;white-space:nowrap}
.legend{position:absolute;top:48%;left:50%;transform:translate(-50%,-50%);font-size:14px;color:#000;width:80%;text-align:center;line-height:1.5}
.meta{position:absolute;left:50%;bottom:18mm;transform:translateX(-50%);font-size:10px;color:#3d1f0f;text-align:center}
.actions{position:fixed;right:16px;bottom:16px}
.actions button{border:1px solid #8B1A1A;background:#8B1A1A;color:white;padding:10px 14px;border-radius:6px;font-weight:700}
@media print{.actions{display:none}html,body{background:white}#diploma{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div id="diploma">
  <div class="title">${titleHtml}</div>
  <div class="name">${escapeHtml(view.studentName)}</div>
  <div class="legend">${legendHtml}</div>
  <div class="meta">Folio: ${escapeHtml(view.folio)} · Verificación: ${escapeHtml(view.verificationCode)} · Emitido: ${formatDate(view.issuedAt)}</div>
</div>
<div class="actions"><button onclick="window.print()">Imprimir / guardar PDF</button></div>
</body>
</html>`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
