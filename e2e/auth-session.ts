import { request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sesiones de e2e por `storageState` (sin formulario).
 *
 * El endpoint /auth/login del producto limita a 10 logins/min por IP (rate-limit
 * real, NO se toca). Cuando cada spec entraba por el formulario, la corrida
 * completa saturaba esa ventana y algún login recibía 429, dejando el test en la
 * pantalla de acceso: de ahí el flakiness que antes se mitigaba con reintentos y
 * esperas de 12 s.
 *
 * Aquí el login ocurre UNA sola vez por rol (vía API, en el global-setup) y se
 * persiste el estado que la app usa para autenticar: las claves de localStorage
 * `tsc_token` y `tsc_user` en el origin del web (ver apps/web/src/app/page.tsx,
 * que en el montaje lee justo esas dos claves). Los specs inyectan ese estado
 * antes de montar la app, así que autentican sin tocar /auth/login: cero presión
 * sobre el rate-limit y sin flakiness.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Capacita2026!";

export type Role = "admin" | "instructor" | "guardia";

export const ROLE_EMAIL: Record<Role, string> = {
  admin: "admin@tsc.local",
  instructor: "instructor@tsc.local",
  guardia: "guardia@tsc.local"
};

const AUTH_DIR = join(__dirname, ".auth");

export function storageStatePath(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}

type LocalStorageEntry = { name: string; value: string };
type StorageState = { cookies: unknown[]; origins: Array<{ origin: string; localStorage: LocalStorageEntry[] }> };

// `pnpm dev` levanta api(:4000)+web(:3000) en paralelo; el webServer de Playwright
// ya garantiza :3000 antes del global-setup, pero el :4000 puede tardar un instante
// más. Esperamos a que responda cualquier cosa (< 500) antes de intentar loguear.
async function waitForApi(ctx: APIRequestContext): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await ctx.get(`${API_URL}/`, { failOnStatusCode: false, timeout: 4000 });
      if (res.status() < 500) {
        return;
      }
    } catch {
      // el API todavía no responde; reintenta
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`El API en ${API_URL} no respondió a tiempo.`);
}

/**
 * Loguea cada rol UNA vez vía API y escribe su storageState en e2e/.auth/<rol>.json.
 * Se llama desde el global-setup, cuando el webServer ya está arriba.
 */
export async function seedRoleStorageStates(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext();
  try {
    await waitForApi(ctx);
    for (const role of Object.keys(ROLE_EMAIL) as Role[]) {
      const res = await ctx.post(`${API_URL}/auth/login`, {
        data: { email: ROLE_EMAIL[role], password: PASSWORD }
      });
      if (!res.ok()) {
        throw new Error(`No se pudo loguear a ${role} (HTTP ${res.status()}) para sembrar el storageState.`);
      }
      const body = (await res.json()) as { token: string; user: unknown };
      const state: StorageState = {
        cookies: [],
        origins: [
          {
            origin: BASE_URL,
            localStorage: [
              { name: "tsc_token", value: body.token },
              { name: "tsc_user", value: JSON.stringify(body.user) }
            ]
          }
        ]
      };
      writeFileSync(storageStatePath(role), JSON.stringify(state, null, 2), "utf8");
    }
  } finally {
    await ctx.dispose();
  }
}

function readSeededLocalStorage(role: Role): LocalStorageEntry[] {
  const raw = JSON.parse(readFileSync(storageStatePath(role), "utf8")) as StorageState;
  return raw.origins[0]?.localStorage ?? [];
}

/**
 * Autentica el rol sembrando su sesión (token + user en localStorage) sin pasar por
 * el formulario. Cargamos una vez el origin del web (pantalla de acceso, sin sesión)
 * para poder escribir en su localStorage, sembramos `tsc_token`/`tsc_user` y
 * recargamos: la app, al montar, los lee y autentica. Reemplaza al login-por-
 * formulario con reintento+12 s. El caller sigue afirmando la cáscara del rol (los
 * asserts no cambian).
 *
 * Se hace por evaluate+reload y NO por addInitScript a propósito: un init script se
 * re-ejecuta en cada navegación y volvería a inyectar esta sesión, pisando a un test
 * que cambie de identidad más adelante (p. ej. activar una cuenta nueva y aterrizar
 * en su propia cáscara). Sembrar una sola vez respeta ese cambio posterior.
 */
export async function establishSession(page: Page, role: Role): Promise<void> {
  const entries = readSeededLocalStorage(role);
  await page.goto("/");
  await page.evaluate((seed: LocalStorageEntry[]) => {
    for (const item of seed) {
      window.localStorage.setItem(item.name, item.value);
    }
  }, entries);
  await page.reload();
}
