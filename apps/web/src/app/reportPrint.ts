// Shared print template for the collaborators report (browser "Guardar como PDF").
// Extracted so both the legacy shell and the Ops-Center report render an identical
// document from the same real /reports/students data.

export type PrintableReportRow = {
  studentName: string;
  email: string;
  serviceLabel: string | null;
  courseTitle: string;
  progressPercent: number | null;
  status: string;
  latestAttempt: { scorePercent: number | null } | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReportPrintHtml(rows: PrintableReportRow[], summary: Record<string, number>) {
  const issuedAt = new Date().toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const summaryCards = Object.entries(summary)
    .map(
      ([label, value]) =>
        `<div class="card"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`
    )
    .join("");

  const tableRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.studentName)}<br><small>${escapeHtml(row.email)}</small></td>
        <td>${escapeHtml(row.serviceLabel ?? "Sin servicio")}</td>
        <td>${escapeHtml(row.courseTitle)}</td>
        <td class="num">${row.progressPercent ?? 0}%</td>
        <td>${escapeHtml(row.status)}</td>
        <td class="num">${row.latestAttempt?.scorePercent ?? "N/D"}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de colaboradores TSC</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #131a2e; margin: 24px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #131a33; padding-bottom: 12px; margin-bottom: 16px; }
  header img { height: 54px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 2px 0 0; color: #5d6b82; font-size: 12px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .card { border: 1px solid #dbe2ec; border-radius: 8px; padding: 8px 12px; min-width: 120px; }
  .card span { display: block; color: #5d6b82; font-size: 11px; text-transform: uppercase; }
  .card strong { font-size: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #131a33; color: #fff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  small { color: #5d6b82; }
  .toolbar { text-align: right; margin-bottom: 12px; }
  .toolbar button { background: #8c1713; color: #fff; border: 0; border-radius: 6px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
  @media print { .no-print { display: none !important; } body { margin: 10mm; } }
</style>
</head>
<body class="theme-light" onload="setTimeout(function(){ window.print(); }, 300)">
  <div class="toolbar no-print"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <header>
    <img src="${escapeHtml(typeof window !== "undefined" ? window.location.origin : "")}/tsc-logo.png" alt="TSC" onerror="this.remove()">
    <div>
      <h1>Reporte de colaboradores</h1>
      <p>TSC Capacita &middot; Generado el ${issuedAt} &middot; ${rows.length} registros</p>
    </div>
  </header>
  <div class="summary">${summaryCards}</div>
  <table>
    <thead>
      <tr><th>Colaborador</th><th>Servicio</th><th>Curso</th><th>Avance</th><th>Estado</th><th>Puntaje</th></tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}
