import { getPrisma } from "@tsc-capacita/db";
import type { NotificationEventType, NotificationLog, NotificationRule, Prisma } from "@prisma/client";
import type { EmailProvider } from "./email.js";

export type NotificationProcessResult = {
  processed: number;
  sent: number;
  failed: number;
};

export async function processPendingNotifications(
  provider: EmailProvider,
  options: { limit?: number } = {}
): Promise<NotificationProcessResult> {
  const logs = await getPrisma().notificationLog.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 25
  });

  let sent = 0;
  let failed = 0;

  for (const log of logs) {
    const ruleId = payloadRecord(log.payload).ruleId;
    const rule = typeof ruleId === "string" ? await getPrisma().notificationRule.findUnique({ where: { id: ruleId } }) : null;
    const email = renderNotificationEmail(log, rule);

    try {
      const result = await provider.send({
        to: log.sentTo,
        subject: email.subject,
        html: email.html,
        text: email.text
      });

      await getPrisma().notificationLog.update({
        where: { id: log.id },
        data: {
          providerId: result.providerId ?? null,
          status: "SENT"
        }
      });
      sent += 1;
    } catch (error) {
      await getPrisma().notificationLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          payload: {
            ...payloadRecord(log.payload),
            error: error instanceof Error ? error.message : String(error)
          }
        }
      });
      failed += 1;
    }
  }

  return {
    processed: logs.length,
    sent,
    failed
  };
}

export function renderNotificationEmail(log: NotificationLog, rule: NotificationRule | null) {
  const payload = payloadRecord(log.payload);
  const subject = rule?.subject || defaultSubject(log.eventType, payload);
  const html = defaultHtml(log.eventType, payload);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return { subject, html, text };
}

function defaultSubject(eventType: NotificationEventType, payload: Record<string, unknown>) {
  switch (eventType) {
    case "QUIZ_PASSED":
      return `Aprobado: ${stringValue(payload.quizTitle) ?? "examen final"}`;
    case "QUIZ_FAILED":
      return `Reprobado: ${stringValue(payload.quizTitle) ?? "examen final"}`;
    case "COURSE_COMPLETED":
      return `Curso completado: ${stringValue(payload.courseTitle) ?? "curso"}`;
    case "CERTIFICATE_ISSUED":
      return `Certificado emitido: ${stringValue(payload.folio) ?? "TSC"}`;
  }
}

function defaultHtml(eventType: NotificationEventType, payload: Record<string, unknown>) {
  switch (eventType) {
    case "QUIZ_PASSED":
    case "QUIZ_FAILED": {
      const approved = eventType === "QUIZ_PASSED";
      return `<p><strong>Resultado de evaluación TSC</strong></p>
<p>Examen: <strong>${escapeHtml(stringValue(payload.quizTitle) ?? "examen final")}</strong>.</p>
<p>Resultado final: <strong>${approved ? "APROBADO" : "REPROBADO"}</strong></p>
<p>Puntaje: ${escapeHtml(String(numberValue(payload.scorePercent) ?? "N/D"))}% · Requerido: ${escapeHtml(String(numberValue(payload.passingScorePercent) ?? "N/D"))}%</p>
<p>El equipo de capacitación TSC.</p>`;
    }
    case "COURSE_COMPLETED":
      return `<p><strong>Curso completado</strong></p><p>Curso: ${escapeHtml(stringValue(payload.courseTitle) ?? "curso")}.</p>`;
    case "CERTIFICATE_ISSUED":
      return `<p><strong>Certificado emitido</strong></p><p>Folio: ${escapeHtml(stringValue(payload.folio) ?? "")}</p><p>Código de verificación: ${escapeHtml(stringValue(payload.verificationCode) ?? "")}</p>`;
  }
}

function payloadRecord(payload: Prisma.JsonValue): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
