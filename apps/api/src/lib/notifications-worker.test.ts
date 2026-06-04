import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import { startNotificationWorker } from "./notifications-worker.js";

function fakeLogger() {
  const calls: { level: string; msg: unknown }[] = [];
  const record = (level: string) => (...args: unknown[]) => {
    calls.push({ level, msg: args[args.length - 1] });
  };
  const logger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
    fatal: record("fatal"),
    trace: record("trace"),
    child() {
      return logger;
    },
    level: "info",
    silent: () => {}
  } as unknown as FastifyBaseLogger;
  return { logger, calls };
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    apiPort: 4000,
    apiPublicUrl: "http://localhost:4000",
    webPublicUrl: "http://localhost:3000",
    databaseUrl: "postgresql://x",
    jwtSecret: "x".repeat(24),
    storageDriver: "local",
    localStorageRoot: "./storage",
    smtp: { host: undefined, port: 587, user: undefined, password: undefined, from: "TSC" },
    certificateBackgroundUrl: undefined,
    certificateBackgroundPath: undefined,
    notificationsWorker: { enabled: true, intervalMs: 60000, batch: 25 },
    corsOrigins: [],
    ...overrides
  };
}

test("worker stays off when disabled", () => {
  const { logger, calls } = fakeLogger();
  const worker = startNotificationWorker(
    baseConfig({ notificationsWorker: { enabled: false, intervalMs: 60000, batch: 25 } }),
    logger
  );
  worker.stop();
  assert.ok(calls.some((c) => c.level === "info"));
});

test("worker does not start without SMTP configured", () => {
  const { logger, calls } = fakeLogger();
  const worker = startNotificationWorker(baseConfig(), logger);
  worker.stop();
  assert.ok(calls.some((c) => c.level === "warn"));
});

test("worker starts when enabled and SMTP configured", () => {
  const { logger, calls } = fakeLogger();
  const worker = startNotificationWorker(
    baseConfig({
      smtp: { host: "smtp.test", port: 587, user: "u", password: "p", from: "TSC" }
    }),
    logger
  );
  // Interval is 60s and unref'd, so no tick fires during the test; stop immediately.
  worker.stop();
  assert.ok(calls.some((c) => c.level === "info"));
});
