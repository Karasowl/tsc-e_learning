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
 *  2. Borra los residuos de QA: el usuario de invitación (qa.invite@tsc.local,
 *     que queda ACTIVE al activarse y el endpoint rechaza re-invitar cuentas
 *     activas con 409) y los anuncios QA "Simulacro ..." con sus avisos in-app
 *     (admin-ola2 publica un anuncio global que no se borra a sí mismo, y los
 *     avisos de anuncios de curso sobreviven al borrado del anuncio por diseño
 *     del producto). Así el roster, la lista de anuncios y las campanas no
 *     crecen corrida tras corrida.
 *
 *  3. Loguea cada rol (admin/instructor/guardia) UNA vez vía API y persiste su
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

  try {
    execSync("pnpm --filter @tsc-capacita/db run db:reset-qa-residues", { stdio: "inherit" });
  } catch (error) {
    console.warn("[global-setup] No se pudieron limpiar los residuos de QA (usuario invitado, anuncios).", error);
  }

  await seedRoleStorageStates();
}
