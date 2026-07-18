import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "./config.js";

describe("config · storage driver", () => {
  const base = { DATABASE_URL: "postgresql://localhost:5433/tsc" };

  it("defaults STORAGE_DRIVER to local when unset", () => {
    assert.equal(readConfig({ ...base }).storageDriver, "local");
  });

  it("accepts local explicitly", () => {
    assert.equal(readConfig({ ...base, STORAGE_DRIVER: "local" }).storageDriver, "local");
  });

  it("rejects the unwired s3 driver instead of silently accepting it", () => {
    assert.throws(() => readConfig({ ...base, STORAGE_DRIVER: "s3" }));
  });
});

describe("config · rate limit", () => {
  const base = { DATABASE_URL: "postgresql://localhost:5433/tsc" };

  it("defaults the global rate limit to 300/min when unset", () => {
    assert.equal(readConfig({ ...base }).rateLimitMax, 300);
  });

  it("honors RATE_LIMIT_MAX so the e2e server can raise the global cap", () => {
    assert.equal(readConfig({ ...base, RATE_LIMIT_MAX: "100000" }).rateLimitMax, 100000);
  });
});
