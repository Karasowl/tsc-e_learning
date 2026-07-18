import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  announcementNotificationCleanupWhere,
  buildAnnouncementNotifications,
  serializeAnnouncement
} from "./announcements.js";

describe("announcementNotificationCleanupWhere (borrado de anuncio limpia su bandeja)", () => {
  it("apunta exactamente a las notificaciones sembradas por ese anuncio", () => {
    assert.deepEqual(announcementNotificationCleanupWhere("a1"), {
      linkType: "announcement",
      linkId: "a1"
    });
  });

  it("coincide con el linkType/linkId que siembra el anuncio global", () => {
    const rows = buildAnnouncementNotifications({
      userIds: ["u1"],
      title: "t",
      body: "b",
      linkType: "announcement",
      linkId: "a9"
    });
    const where = announcementNotificationCleanupWhere("a9");
    assert.equal(rows[0]!.linkType, where.linkType);
    assert.equal(rows[0]!.linkId, where.linkId);
  });
});

describe("buildAnnouncementNotifications", () => {
  it("crea una fila de bandeja ANNOUNCEMENT por destinatario con el enlace del anuncio", () => {
    const rows = buildAnnouncementNotifications({
      userIds: ["u1", "u2"],
      title: "Nuevo módulo",
      body: "Ya está disponible el módulo 3.",
      linkType: "course",
      linkId: "c1"
    });

    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.kind, "ANNOUNCEMENT");
      assert.equal(row.title, "Nuevo módulo");
      assert.equal(row.body, "Ya está disponible el módulo 3.");
      assert.equal(row.linkType, "course");
      assert.equal(row.linkId, "c1");
    }
    assert.deepEqual(
      rows.map((row) => row.userId),
      ["u1", "u2"]
    );
  });

  it("deduplica destinatarios repetidos para no avisar dos veces al mismo usuario", () => {
    const rows = buildAnnouncementNotifications({
      userIds: ["u1", "u1", "u2"],
      title: "t",
      body: "b",
      linkType: "announcement",
      linkId: "a1"
    });
    assert.deepEqual(
      rows.map((row) => row.userId),
      ["u1", "u2"]
    );
  });

  it("no crea filas cuando no hay destinatarios", () => {
    assert.deepEqual(
      buildAnnouncementNotifications({ userIds: [], title: "t", body: "b", linkType: "course", linkId: "c1" }),
      []
    );
  });
});

describe("serializeAnnouncement", () => {
  it("expone el título del curso y el autor por su displayName, sin filtrar objetos crudos", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const row = serializeAnnouncement({
      id: "a1",
      scope: "COURSE",
      courseId: "c1",
      title: "Aviso",
      body: "Cuerpo",
      publishedAt: now,
      createdAt: now,
      author: { displayName: "Instructor" },
      course: { id: "c1", title: "Custodia" }
    });

    assert.equal(row.courseTitle, "Custodia");
    assert.equal(row.author, "Instructor");
    assert.equal(row.scope, "COURSE");
    assert.equal(row.publishedAt, now);
  });

  it("tolera anuncios globales (sin curso) y sin autor", () => {
    const row = serializeAnnouncement({
      id: "a2",
      scope: "GLOBAL",
      courseId: null,
      title: "Global",
      body: "Cuerpo",
      publishedAt: null,
      createdAt: new Date(),
      author: null,
      course: null
    });
    assert.equal(row.courseTitle, null);
    assert.equal(row.author, null);
    assert.equal(row.courseId, null);
  });
});
