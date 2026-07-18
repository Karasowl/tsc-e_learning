import { execSync } from "node:child_process";
import { seedRoleStorageStates } from "./auth-session";

/**
 * Preparación única antes de la corrida de e2e:
 *
 *  1. Devuelve al guardia sembrado al estado "Seguridad Intramuros: inscrito sin
 *     empezar" para que el spec verifique el +10 XP real de completar una lección
 *     una y otra vez (el XP es idempotente por lección, así que sin este reset una
 *     segunda corrida no volvería a otorgarlo). Solo toca datos del guardia; si la
 *     BD no está sembrada, es un no-op tolerante.
 *
 *  2. Loguea cada rol (admin/instructor/guardia) UNA vez vía API y persiste su
 *     storageState (localStorage tsc_token/tsc_user). Los specs reutilizan ese
 *     estado en lugar de entrar por el formulario, lo que elimina la presión sobre
 *     el rate-limit real de /auth/login (10/min por IP) que hacía flakear la suite.
 *     El webServer de Playwright ya está arriba cuando corre el global-setup.
 */
export default async function globalSetup() {
  try {
    execSync("pnpm --filter @tsc-capacita/db run db:reset-guardia", { stdio: "inherit" });
  } catch (error) {
    console.warn("[global-setup] No se pudo resetear el progreso del guardia (¿BD sembrada?).", error);
  }

  await seedRoleStorageStates();
}
