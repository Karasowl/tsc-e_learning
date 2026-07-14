import { execSync } from "node:child_process";

/**
 * Antes de cada corrida de e2e, devuelve al guardia sembrado al estado
 * "Seguridad Intramuros: inscrito sin empezar" para que el spec verifique el
 * +10 XP real de completar una lección una y otra vez (el XP es idempotente por
 * lección, así que sin este reset una segunda corrida no volvería a otorgarlo).
 * Solo toca datos del guardia; si la BD no está sembrada, es un no-op tolerante.
 */
export default function globalSetup() {
  try {
    execSync("pnpm --filter @tsc-capacita/db run db:reset-guardia", { stdio: "inherit" });
  } catch (error) {
    console.warn("[global-setup] No se pudo resetear el progreso del guardia (¿BD sembrada?).", error);
  }
}
