import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { emitAnnouncementPublishedNotification, renderNotificationEmail } from "./notifications.js";

// Stub mínimo de Prisma para el evento de anuncio: emula el filtro
// { eventType, enabled: true } del findMany real y captura los logs creados.
function announcementClientStub(rules: Array<{ id: string; eventType: string; recipients: string[]; enabled: boolean }>) {
  const createdLogs: Array<Record<string, unknown>> = [];
  const client = {
    notificationRule: {
      findMany: async ({ where }: { where: { eventType: string; enabled: boolean } }) =>
        rules.filter((rule) => rule.eventType === where.eventType && rule.enabled === where.enabled)
    },
    notificationLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdLogs.push(data);
        return data;
      }
    }
  } as unknown as Prisma.TransactionClient;
  return { client, createdLogs };
}

describe("emitAnnouncementPublishedNotification (copia por correo a RH, sin correo al alumno)", () => {
  const args = {
    announcementId: "a1",
    title: "Cambio de horario",
    scope: "COURSE" as const,
    courseId: "c1",
    courseTitle: "Custodia de valores",
    authorName: "Instructor Uno"
  };

  it("con regla habilitada crea UN log con los destinatarios de la regla (RH), sin alumnos", async () => {
    const { client, createdLogs } = announcementClientStub([
      { id: "r1", eventType: "ANNOUNCEMENT_PUBLISHED", recipients: ["RH@tsc.com.mx", " gerencia@tsc.com.mx "], enabled: true }
    ]);

    const created = await emitAnnouncementPublishedNotification(args, client);

    assert.equal(created, true);
    assert.equal(createdLogs.length, 1);
    const log = createdLogs[0]!;
    assert.equal(log.eventType, "ANNOUNCEMENT_PUBLISHED");
    assert.equal(log.userId, null);
    assert.equal(log.courseId, "c1");
    assert.deepEqual(log.sentTo, ["rh@tsc.com.mx", "gerencia@tsc.com.mx"]);
    const payload = log.payload as Record<string, unknown>;
    assert.equal(payload.announcementTitle, "Cambio de horario");
    assert.equal(payload.scope, "COURSE");
    assert.equal(payload.courseTitle, "Custodia de valores");
    assert.equal(payload.authorName, "Instructor Uno");
    assert.equal(payload.ruleId, "r1");
  });

  it("sin regla configurada no crea nada (el correo a RH es opt-in)", async () => {
    const { client, createdLogs } = announcementClientStub([]);
    const created = await emitAnnouncementPublishedNotification(args, client);
    assert.equal(created, false);
    assert.equal(createdLogs.length, 0);
  });

  it("con la regla deshabilitada tampoco crea nada", async () => {
    const { client, createdLogs } = announcementClientStub([
      { id: "r1", eventType: "ANNOUNCEMENT_PUBLISHED", recipients: ["rh@tsc.com.mx"], enabled: false }
    ]);
    const created = await emitAnnouncementPublishedNotification(args, client);
    assert.equal(created, false);
    assert.equal(createdLogs.length, 0);
  });

  it("una regla habilitada pero sin destinatarios utilizables no genera log", async () => {
    const { client, createdLogs } = announcementClientStub([
      { id: "r1", eventType: "ANNOUNCEMENT_PUBLISHED", recipients: ["  ", ""], enabled: true }
    ]);
    const created = await emitAnnouncementPublishedNotification(args, client);
    assert.equal(created, false);
    assert.equal(createdLogs.length, 0);
  });

  it("el correo del anuncio global dice alcance de toda la plataforma en español", () => {
    const email = renderNotificationEmail(
      {
        id: "log",
        eventType: "ANNOUNCEMENT_PUBLISHED",
        userId: null,
        courseId: null,
        payload: { announcementTitle: "Nueva política", scope: "GLOBAL", authorName: "Dirección" },
        sentTo: ["rh@tsc.com.mx"],
        providerId: null,
        status: "PENDING",
        createdAt: new Date()
      },
      null
    );

    assert.equal(email.subject, "Anuncio publicado: Nueva política");
    assert.match(email.html, /Nueva política/);
    assert.match(email.html, /toda la plataforma/);
    assert.match(email.html, /Dirección/);
  });

  it("el correo del anuncio de curso nombra el curso", () => {
    const email = renderNotificationEmail(
      {
        id: "log",
        eventType: "ANNOUNCEMENT_PUBLISHED",
        userId: null,
        courseId: "c1",
        payload: { announcementTitle: "Cambio de horario", scope: "COURSE", courseTitle: "Custodia de valores" },
        sentTo: ["rh@tsc.com.mx"],
        providerId: null,
        status: "PENDING",
        createdAt: new Date()
      },
      null
    );

    assert.match(email.html, /Custodia de valores/);
    assert.match(email.html, /curso/);
  });
});

describe("notifications", () => {
  it("renders pass/fail email body compatible with the WordPress template intent", () => {
    const pass = renderNotificationEmail(
      {
        id: "log",
        eventType: "QUIZ_PASSED",
        userId: "user",
        courseId: "course",
        payload: { quizTitle: "Final", scorePercent: 90, passingScorePercent: 80 },
        sentTo: ["admin@example.com"],
        providerId: null,
        status: "PENDING",
        createdAt: new Date()
      },
      null
    );

    assert.match(pass.subject, /Aprobado/);
    assert.match(pass.html, /APROBADO/);
    assert.match(pass.html, /90/);
  });
});
