import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeEarnedBadges } from "./users-admin.js";

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
