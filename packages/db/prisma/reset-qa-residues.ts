/**
 * Limpia los residuos que los specs de QA dejan en la BD local entre corridas.
 * Corre en el global-setup de Playwright antes de cada suite.
 *
 * 1. Usuarios QA de invitacion (emails que empiezan con "qa.invite"): el spec de
 *    admin usa el email FIJO qa.invite@tsc.local, pero su flujo ACTIVA la cuenta
 *    y el endpoint de invitacion rechaza re-invitar cuentas activas (409, ver
 *    users-admin.ts). Por eso cada corrida parte de cero borrando la cuenta. El
 *    patron por prefijo tambien limpia los qa.invite+<timestamp> antiguos. Las
 *    dependencias cuelgan de User con onDelete: Cascade (UserRole,
 *    InvitationToken, Notification, Enrollment, etc.), asi que basta el
 *    deleteMany. AuditEvent usa SetNull y conserva la bitacora.
 *
 * 2. Anuncios QA ("Simulacro de gobierno ..." de admin-ola2.spec y "Simulacro
 *    nocturno ..." de instructor.spec) y sus avisos in-app. Todo anuncio (curso
 *    o global) siembra sus avisos con linkType "announcement" + su id, y el
 *    DELETE del producto ya limpia esos avisos junto con el anuncio. Aqui solo
 *    queda cubrir los anuncios QA que ningun spec borra (el GLOBAL de
 *    admin-ola2) o que quedaron a medias por una corrida abortada: se eliminan
 *    primero sus Notification (por linkId) y despues los Announcement. El
 *    anuncio sembrado ("Lineamientos de uso de la plataforma") no coincide con
 *    el patron y queda intacto.
 *
 * Correr:  pnpm --filter @tsc-capacita/db run db:reset-qa-residues
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Titulos que los specs de QA publican (hoy fijos: "... (QA)"; el prefijo
// tambien cubre los "Simulacro ... <timestamp>" de corridas antiguas).
const QA_ANNOUNCEMENT_TITLE_PATTERNS = ["Simulacro de gobierno", "Simulacro nocturno"];

// ---------------------------------------------------------------------------
// Guarda de entorno (misma que el seed): este script BORRA datos y SOLO debe
// correr contra la base local de desarrollo. Aborta (sin escribir nada) si
// NODE_ENV es production o si DATABASE_URL apunta a un host que no sea local.
// ALLOW_SEED=1 fuerza la corrida bajo responsabilidad de quien la ejecuta.
// ---------------------------------------------------------------------------
function assertLocalResetTarget() {
  if (process.env.ALLOW_SEED === "1") {
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "db:reset-qa-residues abortado: NODE_ENV=production. La limpieza QA solo debe correr contra una base local de desarrollo. Usa ALLOW_SEED=1 para forzarla bajo tu propia responsabilidad."
    );
  }

  const rawUrl = process.env.DATABASE_URL ?? "";
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(
      "db:reset-qa-residues abortado: DATABASE_URL ausente o no parseable. La limpieza QA solo corre contra una base local (localhost/127.0.0.1). Usa ALLOW_SEED=1 para forzarla."
    );
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(host)) {
    throw new Error(
      `db:reset-qa-residues abortado: DATABASE_URL apunta a un host no local (${host}). La limpieza QA solo corre contra localhost/127.0.0.1 (base de desarrollo, típicamente :5433). Usa ALLOW_SEED=1 para forzarla bajo tu propia responsabilidad.`
    );
  }
}

async function main() {
  assertLocalResetTarget();

  const removedUsers = await prisma.user.deleteMany({
    where: { email: { startsWith: "qa.invite" } }
  });

  const titleFilters = QA_ANNOUNCEMENT_TITLE_PATTERNS.map((prefix) => ({
    title: { startsWith: prefix }
  }));

  const qaAnnouncements = await prisma.announcement.findMany({
    where: { OR: titleFilters },
    select: { id: true }
  });
  const qaAnnouncementIds = qaAnnouncements.map((row) => row.id);

  // Avisos de los anuncios QA aun presentes (curso y global enlazan igual:
  // linkType "announcement" + id del anuncio).
  const removedNotifications = await prisma.notification.deleteMany({
    where: { linkType: "announcement", linkId: { in: qaAnnouncementIds } }
  });

  const removedAnnouncements = await prisma.announcement.deleteMany({
    where: { id: { in: qaAnnouncementIds } }
  });

  console.log(
    `[reset-qa-residues] ${removedUsers.count} usuario(s) QA de invitacion, ${removedAnnouncements.count} anuncio(s) QA y ${removedNotifications.count} aviso(s) in-app QA eliminados.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
