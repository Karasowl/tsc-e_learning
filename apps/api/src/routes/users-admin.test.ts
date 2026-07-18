import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksManualActivation, dedupeEarnedBadges, serializeDossierCertificates } from "./users-admin.js";

describe("blocksManualActivation (sin credencial utilizable no hay paso manual a ACTIVE)", () => {
  it("bloquea el paso a ACTIVE sin passwordHash ni hash legado (invitado sin activar)", () => {
    assert.equal(
      blocksManualActivation({ passwordHash: null, legacyPasswordHash: null, nextStatus: "ACTIVE" }),
      true
    );
  });

  it("cierra el rodeo INVITED→DISABLED→ACTIVE: sigue bloqueado porque decide por credenciales", () => {
    // El estado actual ya no importa: sin ninguna credencial no se activa a mano.
    assert.equal(
      blocksManualActivation({ passwordHash: null, legacyPasswordHash: null, nextStatus: "ACTIVE" }),
      true
    );
  });

  it("permite activar una cuenta que ya tiene contraseña propia", () => {
    assert.equal(
      blocksManualActivation({ passwordHash: "$hash", legacyPasswordHash: null, nextStatus: "ACTIVE" }),
      false
    );
  });

  it("permite reactivar una cuenta migrada que solo conserva el hash legado de WordPress", () => {
    assert.equal(
      blocksManualActivation({ passwordHash: null, legacyPasswordHash: "$wp$hash", nextStatus: "ACTIVE" }),
      false
    );
  });

  it("no bloquea cuando el cambio no toca el estado", () => {
    assert.equal(
      blocksManualActivation({ passwordHash: null, legacyPasswordHash: null, nextStatus: undefined }),
      false
    );
  });

  it("no bloquea suspender (DISABLED) aunque falten credenciales", () => {
    assert.equal(
      blocksManualActivation({ passwordHash: null, legacyPasswordHash: null, nextStatus: "DISABLED" }),
      false
    );
  });
});

describe("dedupeEarnedBadges (expediente de usuario)", () => {
  it("colapsa varios awards del mismo logro conservando la fecha más antigua", () => {
    const early = new Date("2025-01-01T00:00:00Z");
    const late = new Date("2026-01-01T00:00:00Z");
    const badges = dedupeEarnedBadges([
      { achievementId: "a1", awardedAt: late, achievement: { slug: "primer-diploma", title: "Primer diploma", points: 50 } },
      { achievementId: "a1", awardedAt: early, achievement: { slug: "primer-diploma", title: "Primer diploma", points: 50 } }
    ]);

    assert.equal(badges.length, 1);
    assert.equal(badges[0]!.awardedAt, early);
    assert.equal(badges[0]!.slug, "primer-diploma");
  });

  it("conserva una entrada por cada logro distinto", () => {
    const now = new Date();
    const badges = dedupeEarnedBadges([
      { achievementId: "a1", awardedAt: now, achievement: { slug: "s1", title: "T1", points: 10 } },
      { achievementId: "a2", awardedAt: now, achievement: { slug: "s2", title: "T2", points: 20 } }
    ]);
    assert.equal(badges.length, 2);
    assert.deepEqual(badges.map((b) => b.slug).sort(), ["s1", "s2"]);
  });
});

describe("serializeDossierCertificates (diplomas del expediente admin)", () => {
  it("incluye los revocados con su status y fecha para la pill 'Revocado' de la UI", () => {
    const issuedAt = new Date("2026-05-15T00:00:00Z");
    const revokedAt = new Date("2026-07-17T00:00:00Z");
    const rows = serializeDossierCertificates([
      {
        id: "cert1",
        status: "ISSUED",
        folio: "TSC-20260515-AAAA1111",
        issuedAt,
        revokedAt: null,
        course: { id: "c1", title: "Protección" }
      },
      {
        id: "cert2",
        status: "REVOKED",
        folio: "TSC-20260601-BBBB2222",
        issuedAt,
        revokedAt,
        course: { id: "c2", title: "Custodia" }
      }
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      id: "cert1",
      status: "ISSUED",
      folio: "TSC-20260515-AAAA1111",
      issuedAt,
      revokedAt: null,
      courseId: "c1",
      courseTitle: "Protección"
    });
    assert.equal(rows[1]!.status, "REVOKED");
    assert.equal(rows[1]!.revokedAt, revokedAt);
    assert.equal(rows[1]!.courseTitle, "Custodia");
  });
});
