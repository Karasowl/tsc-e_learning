import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivationUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationState,
  renderInvitationEmail,
  INVITATION_TTL_MS
} from "./invitations.js";
import type { AppConfig } from "./config.js";

function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    apiPort: 4000,
    apiPublicUrl: "http://localhost:4000",
    webPublicUrl: "http://localhost:3000",
    databaseUrl: "postgres://x",
    jwtSecret: "x".repeat(24),
    jwtExpiresIn: "30d",
    googleClientId: undefined,
    storageDriver: "local",
    localStorageRoot: "./storage",
    smtp: { host: undefined, port: 587, user: undefined, password: undefined, from: "TSC <a@b.c>" },
    certificateBackgroundUrl: undefined,
    certificateBackgroundPath: undefined,
    notificationsWorker: { enabled: false, intervalMs: 60000, batch: 25 },
    rateLimitMax: 300,
    corsOrigins: [],
    ...overrides
  };
}

describe("invitations · token lifecycle", () => {
  it("hashing is deterministic and never returns the raw token", () => {
    const raw = "abc123-xyz";
    assert.equal(hashInvitationToken(raw), hashInvitationToken(raw));
    assert.notEqual(hashInvitationToken(raw), raw);
    assert.match(hashInvitationToken(raw), /^[0-9a-f]{64}$/);
  });

  it("generateInvitationToken yields a raw token whose hash matches the stored hash", () => {
    const { raw, hash } = generateInvitationToken();
    assert.ok(raw.length >= 32, "raw token must be reasonably long");
    assert.equal(hashInvitationToken(raw), hash);
    // Two invitations never collide.
    assert.notEqual(generateInvitationToken().raw, generateInvitationToken().raw);
  });

  it("classifies a fresh token as valid, a consumed token as used, a past token as expired", () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const future = new Date(now.getTime() + INVITATION_TTL_MS);
    const past = new Date(now.getTime() - 1000);

    assert.equal(invitationState({ usedAt: null, expiresAt: future }, now), "valid");
    assert.equal(invitationState({ usedAt: new Date(now), expiresAt: future }, now), "used");
    assert.equal(invitationState({ usedAt: null, expiresAt: past }, now), "expired");
    // "used" wins even if also expired — the token is spent.
    assert.equal(invitationState({ usedAt: new Date(now), expiresAt: past }, now), "used");
  });

  it("builds an activation URL under /activar with the raw token, no double slash", () => {
    assert.equal(
      buildActivationUrl(fakeConfig({ webPublicUrl: "http://localhost:3000" }), "TOKEN123"),
      "http://localhost:3000/activar/TOKEN123"
    );
    assert.equal(
      buildActivationUrl(fakeConfig({ webPublicUrl: "https://capacita.tsc.mx/" }), "TOKEN123"),
      "https://capacita.tsc.mx/activar/TOKEN123"
    );
  });

  it("renders an invitation email that carries the activation link and greets the invitee", () => {
    const email = renderInvitationEmail({ displayName: "Ana Ruiz", url: "http://localhost:3000/activar/TK" });
    assert.match(email.subject, /Activa tu cuenta/i);
    assert.match(email.html, /Ana Ruiz/);
    assert.match(email.html, /http:\/\/localhost:3000\/activar\/TK/);
    assert.match(email.text, /http:\/\/localhost:3000\/activar\/TK/);
  });

  it("escapes HTML in the invitee name to avoid injection in the email body", () => {
    const email = renderInvitationEmail({ displayName: "<b>x</b>", url: "http://x/activar/t" });
    assert.doesNotMatch(email.html, /<b>x<\/b>/);
    assert.match(email.html, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});
