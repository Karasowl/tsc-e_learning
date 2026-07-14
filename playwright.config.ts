import { defineConfig, devices } from "@playwright/test";

/**
 * E2E del LMS TSC Capacita. Verifica el skin dark-first de la Fase 0 por rol.
 * `pnpm e2e` autoarranca api+web (pnpm dev) y espera al web en :3000.
 * La BD local (Postgres :5433) debe estar corriendo y sembrada.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
    trace: "on",
    navigationTimeout: 60_000,
    actionTimeout: 20_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
