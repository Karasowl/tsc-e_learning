import { getPrisma } from "@tsc-capacita/db";
import type { NotificationEventType, NotificationLog, NotificationRule, Prisma } from "@prisma/client";
import type { EmailProvider } from "./email.js";

export type NotificationProcessResult = {
  processed: number;
  sent: number;
  failed: number;
};

/**
 * Emits exactly ONE NotificationLog for a student-facing event.
 *
 * Replicates the WordPress behaviour: the student always receives their own
 * result. RH/admin copies come from the configured NotificationRule recipients,
 * but the student is included even when no rule exists.
 *
 * Recipients = the student's email (loaded from User by userId) PLUS the
 * recipients of every enabled rule that matches the event (copy to RH/admin),
 * deduplicated so nobody is mailed twice. The log is created even when there is
 * no matching rule, so the student is always notified. The first matching rule
 * (if any) is recorded in the payload as `ruleId` so the worker can pick up a
 * custom subject.
 */
export async function emitStudentNotification(args: {
  eventType: NotificationEventType;
  userId: string;
  courseId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const prisma = getPrisma();

  const [student, rules] = await Promise.all([
    prisma.user.findUnique({ where: { id: args.userId }, select: { email: true, displayName: true } }),
    prisma.notificationRule.findMany({ where: { eventType: args.eventType, enabled: true } })
  ]);

  const recipients = new Set<string>();

  const studentEmail = student?.email?.trim();
  if (studentEmail) {
    recipients.add(studentEmail.toLowerCase());
  }

  for (const rule of rules) {
    for (const recipient of rule.recipients) {
      const normalized = recipient?.trim();
      if (normalized) {
        recipients.add(normalized.toLowerCase());
      }
    }
  }

  // Nothing to deliver (no student email and no rule recipients): skip.
  if (recipients.size === 0) {
    return;
  }

  const firstRuleId = rules[0]?.id ?? null;
  const studentName = student?.displayName?.trim();

  await prisma.notificationLog.create({
    data: {
      eventType: args.eventType,
      userId: args.userId,
      courseId: args.courseId,
      payload: {
        ...args.payload,
        ...(studentName ? { studentName } : {}),
        ...(firstRuleId ? { ruleId: firstRuleId } : {})
      },
      sentTo: Array.from(recipients),
      status: "PENDING"
    }
  });
}

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
  const studentName = stringValue(payload.studentName);
  const greeting = studentName ? `Hola, ${escapeHtml(studentName)}:` : "Hola:";

  switch (eventType) {
    case "QUIZ_PASSED":
    case "QUIZ_FAILED": {
      const approved = eventType === "QUIZ_PASSED";
      const quizTitle = escapeHtml(stringValue(payload.quizTitle) ?? "examen final");
      const courseTitle = stringValue(payload.courseTitle);
      const score = numberValue(payload.scorePercent);
      const passing = numberValue(payload.passingScorePercent);
      const scoreLine =
        score !== null
          ? `<p>Tu puntaje fue <strong>${escapeHtml(String(score))}%</strong>${
              passing !== null ? ` (puntaje requerido: ${escapeHtml(String(passing))}%)` : ""
            }.</p>`
          : "";
      const courseLine = courseTitle ? `<p>Curso: <strong>${escapeHtml(courseTitle)}</strong>.</p>` : "";
      const message = approved
        ? `<p>¡Felicidades! Has <strong>APROBADO</strong> el examen <strong>${quizTitle}</strong>.</p>`
        : `<p>Esta vez no alcanzaste el puntaje necesario para aprobar el examen <strong>${quizTitle}</strong>: el resultado fue <strong>REPROBADO</strong>. No te desanimes, puedes volver a intentarlo cuando estés listo.</p>`;
      return `<p>${greeting}</p>
${message}
${courseLine}${scoreLine}
<p>Un saludo,<br />El equipo de capacitación TSC</p>`;
    }
    case "COURSE_COMPLETED": {
      const courseTitle = escapeHtml(stringValue(payload.courseTitle) ?? "tu curso");
      return `<p>${greeting}</p>
<p>¡Felicidades! Has <strong>completado</strong> el curso <strong>${courseTitle}</strong>.</p>
<p>Gracias por tu dedicación y esfuerzo.</p>
<p>Un saludo,<br />El equipo de capacitación TSC</p>`;
    }
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
