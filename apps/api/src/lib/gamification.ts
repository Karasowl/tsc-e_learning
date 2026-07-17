/**
 * Motor de gamificacion ("carrera del guardia").
 *
 * XP real y persistido: el XP total de un usuario es la suma de sus
 * `AchievementEvent.points` (incluye el historial GamiPress importado con
 * sourceSystem "seed" y los eventos nuevos que este motor otorga con
 * sourceSystem "ledger"). Cada evento nuevo lleva una clave idempotente
 * (p.ej. "LESSON:<lessonId>", "CERT:<courseId>") para no doble-otorgar.
 *
 * La idempotencia se apoya en la restriccion unica ya existente del esquema
 * `@@unique([sourceSystem, sourceId])` de AchievementEvent / AchievementAward.
 * Como esa clave es global (no por usuario), el `sourceId` se namespacea con el
 * userId: `${userId}:${key}`. Asi dos usuarios pueden completar la misma leccion
 * sin colisionar, y el mismo usuario no cobra dos veces el mismo evento.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/** Marca de origen para las filas creadas por este motor (vs. "seed" de GamiPress). */
export const LEDGER_SOURCE = "ledger";

/** Puntos de XP por evento real. */
export const XP_LESSON_COMPLETED = 10;
export const XP_CERTIFICATE_ISSUED = 240;

// ---------------------------------------------------------------------------
// Rangos (funcion pura)
// ---------------------------------------------------------------------------
export type Rank = { level: number; name: string; floor: number };

/**
 * Umbrales y nombres de la carrera. `level` es 1-based (Aspirante = nivel 1)
 * para que el front pueda mostrar "Nivel N" de forma natural y para que
 * `after.level > before.level` detecte un ascenso.
 */
export const RANKS: Rank[] = [
  { level: 1, name: "Aspirante", floor: 0 },
  { level: 2, name: "Guardia", floor: 400 },
  { level: 3, name: "Guardia 1ª", floor: 1000 },
  { level: 4, name: "Supervisor", floor: 1500 },
  { level: 5, name: "Jefe de Turno", floor: 2400 },
  { level: 6, name: "Comandante", floor: 3600 }
];

export type RankInfo = {
  level: number;
  name: string;
  xp: number;
  floor: number;
  /** XP donde empieza el siguiente rango, o null si ya es el rango maximo. */
  next: number | null;
  /** XP que falta para el siguiente rango, o null en el rango maximo. */
  toNext: number | null;
  /** Avance dentro del rango actual, 0..100 (con 2 decimales). */
  pct: number;
};

/**
 * Deriva el rango a partir del XP total. Funcion pura y total: cualquier XP
 * (incluido negativo, NaN o fraccion) cae en un rango valido.
 */
export function rankInfo(xp: number): RankInfo {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;

  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) {
    if (safeXp >= RANKS[i]!.floor) {
      index = i;
    }
  }

  const current = RANKS[index]!;
  const nextRank = RANKS[index + 1] ?? null;
  const next = nextRank ? nextRank.floor : null;
  const toNext = next === null ? null : Math.max(0, next - safeXp);

  let pct: number;
  if (next === null) {
    pct = 100;
  } else {
    const span = next - current.floor;
    pct = span > 0 ? ((safeXp - current.floor) / span) * 100 : 0;
  }
  pct = Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;

  return {
    level: current.level,
    name: current.name,
    xp: safeXp,
    floor: current.floor,
    next,
    toNext,
    pct
  };
}

/**
 * Detecta si pasar de `xpBefore` a `xpAfter` produjo un ascenso de rango.
 * Funcion pura y total sobre `rankInfo` (reutiliza los mismos umbrales, no los
 * redefine): hay ascenso cuando el nivel del rango resultante es mayor que el
 * inicial. `rankName` es el nombre del rango tras el cambio.
 */
export function detectAscension(
  xpBefore: number,
  xpAfter: number
): { ascended: boolean; rankName: string } {
  const rankBefore = rankInfo(xpBefore);
  const rankAfter = rankInfo(xpAfter);
  return {
    ascended: rankAfter.level > rankBefore.level,
    rankName: rankAfter.name
  };
}

// ---------------------------------------------------------------------------
// Ledger de XP (idempotente)
// ---------------------------------------------------------------------------
/** `sourceId` idempotente por usuario para un evento del ledger. */
export function ledgerSourceId(userId: string, key: string): string {
  return `${userId}:${key}`;
}

/** Suma pura de puntos de una lista de eventos (usado en tests y calculos). */
export function sumPoints(events: Array<{ points: number }>): number {
  return events.reduce((total, event) => total + event.points, 0);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export type GrantXpResult = {
  /** true si este llamado inserto un evento nuevo (XP realmente otorgado ahora). */
  created: boolean;
  /** Puntos sumados en este llamado (0 si el evento ya existia). */
  xpDelta: number;
  /** XP total del usuario despues de este llamado. */
  xpTotal: number;
  event: { id: string; points: number; title: string };
};

/**
 * XP total de un usuario = suma de TODOS sus AchievementEvent.points
 * (historial GamiPress + eventos del ledger).
 */
export async function totalXp(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string
): Promise<number> {
  const aggregate = await prisma.achievementEvent.aggregate({
    where: { userId },
    _sum: { points: true }
  });
  return aggregate._sum.points ?? 0;
}

/**
 * Otorga XP por un evento real de forma idempotente. Si la clave ya fue
 * otorgada (mismo userId + key), no crea otro evento: devuelve created=false y
 * xpDelta=0. La condicion de carrera (dos llamados simultaneos) queda cubierta
 * por la restriccion unica: el segundo cae en P2002 y se resuelve leyendo el
 * evento ya existente.
 */
export async function grantXp(
  prisma: PrismaClient,
  opts: {
    userId: string;
    key: string;
    points: number;
    title: string;
    pointsType?: string;
    occurredAt?: Date;
  }
): Promise<GrantXpResult> {
  const sourceId = ledgerSourceId(opts.userId, opts.key);
  const occurredAt = opts.occurredAt ?? new Date();

  let created = false;
  let event: { id: string; points: number; title: string } | null = null;

  try {
    const inserted = await prisma.achievementEvent.create({
      data: {
        userId: opts.userId,
        title: opts.title,
        points: opts.points,
        pointsType: opts.pointsType ?? "ledger",
        occurredAt,
        sourceSystem: LEDGER_SOURCE,
        sourceId
      }
    });
    created = true;
    event = { id: inserted.id, points: inserted.points, title: inserted.title };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const existing = await prisma.achievementEvent.findUnique({
      where: { sourceSystem_sourceId: { sourceSystem: LEDGER_SOURCE, sourceId } }
    });
    if (!existing) {
      throw error;
    }
    event = { id: existing.id, points: existing.points, title: existing.title };
  }

  const xpTotal = await totalXp(prisma, opts.userId);

  return {
    created,
    xpDelta: created ? opts.points : 0,
    xpTotal,
    event
  };
}

// ---------------------------------------------------------------------------
// Insignias (AchievementAward), idempotentes por usuario + logro
// ---------------------------------------------------------------------------
export type AwardBadgeResult = {
  /** true si esta llamada creo el award. */
  awarded: boolean;
  /** true si el usuario ya tenia la insignia (seed o llamada previa). */
  alreadyHad: boolean;
};

/**
 * Otorga una insignia por su slug si el usuario aun no la tiene. Preserva los
 * awards existentes (incluidos los sembrados por GamiPress): si ya existe
 * cualquier AchievementAward para (userId, achievementId), no crea otro.
 *
 * Nota: las insignias NO suman XP. El XP se rige solo por AchievementEvent para
 * mantener el total exacto y auditable; los puntos de la insignia son un premio
 * paralelo que se muestra en /me/badges.
 */
export async function awardBadge(
  prisma: PrismaClient,
  opts: { userId: string; slug: string; courseId?: string | null; awardedAt?: Date | undefined }
): Promise<AwardBadgeResult> {
  const achievement = await prisma.achievement.findUnique({ where: { slug: opts.slug } });
  if (!achievement) {
    return { awarded: false, alreadyHad: false };
  }

  const existing = await prisma.achievementAward.findFirst({
    where: { userId: opts.userId, achievementId: achievement.id }
  });
  if (existing) {
    return { awarded: false, alreadyHad: true };
  }

  const sourceId = ledgerSourceId(opts.userId, `ACH:${opts.slug}`);
  try {
    await prisma.achievementAward.create({
      data: {
        sourceSystem: LEDGER_SOURCE,
        sourceId,
        userId: opts.userId,
        achievementId: achievement.id,
        courseId: opts.courseId ?? null,
        points: achievement.points,
        awardedAt: opts.awardedAt ?? new Date()
      }
    });
    return { awarded: true, alreadyHad: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { awarded: false, alreadyHad: true };
    }
    throw error;
  }
}

/**
 * Otorga las insignias de progreso de cursos cuando un usuario completa uno.
 * `completedCourses` es el conteo de inscripciones COMPLETED tras la
 * finalizacion. Idempotente por insignia.
 */
export async function awardCourseCompletionBadges(
  prisma: PrismaClient,
  opts: { userId: string; courseId: string; completedCourses: number; awardedAt?: Date | undefined }
): Promise<void> {
  if (opts.completedCourses >= 1) {
    await awardBadge(prisma, {
      userId: opts.userId,
      slug: "primer-diploma",
      courseId: opts.courseId,
      awardedAt: opts.awardedAt
    });
  }
  if (opts.completedCourses >= 3) {
    await awardBadge(prisma, {
      userId: opts.userId,
      slug: "tres-cursos",
      courseId: opts.courseId,
      awardedAt: opts.awardedAt
    });
  }
}

/**
 * Otorga las insignias de examen cuando un usuario aprueba uno. `scorePercent`
 * es el porcentaje del intento aprobado. Idempotente por insignia.
 */
export async function awardQuizPassedBadges(
  prisma: PrismaClient,
  opts: { userId: string; courseId: string; scorePercent: number; awardedAt?: Date | undefined }
): Promise<void> {
  await awardBadge(prisma, {
    userId: opts.userId,
    slug: "examinador-aprobado",
    courseId: opts.courseId,
    awardedAt: opts.awardedAt
  });
  if (opts.scorePercent >= 100) {
    await awardBadge(prisma, {
      userId: opts.userId,
      slug: "examen-perfecto",
      courseId: opts.courseId,
      awardedAt: opts.awardedAt
    });
  }
}
