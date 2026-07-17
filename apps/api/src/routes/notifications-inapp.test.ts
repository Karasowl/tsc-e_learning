import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeNotification } from "./notifications-inapp.js";

describe("serializeNotification", () => {
  it("marca read=false cuando readAt es null (bandeja no leída)", () => {
    const row = serializeNotification({
      id: "n1",
      kind: "ANNOUNCEMENT",
      title: "Aviso",
      body: "Cuerpo",
      linkType: "course",
      linkId: "c1",
      readAt: null,
      createdAt: new Date()
    });
    assert.equal(row.read, false);
    assert.equal(row.readAt, null);
    assert.equal(row.linkType, "course");
    assert.equal(row.linkId, "c1");
  });

  it("marca read=true cuando hay readAt", () => {
    const readAt = new Date("2026-07-17T10:00:00Z");
    const row = serializeNotification({
      id: "n2",
      kind: "SYSTEM",
      title: "t",
      body: null,
      linkType: null,
      linkId: null,
      readAt,
      createdAt: new Date()
    });
    assert.equal(row.read, true);
    assert.equal(row.readAt, readAt);
    assert.equal(row.body, null);
  });
});
