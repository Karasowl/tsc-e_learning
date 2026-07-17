/**
 * Reglas de acceso progresivo del estudiante ("candados"), como funciones puras
 * y totales para poder probarlas sin base de datos y reutilizarlas en las rutas.
 *
 * IMPORTANTE (Ola 2, Fase A): este modulo SOLO computa el estado informativo
 * (locked / lockReason / available / examLocked / expired). NO aplica rechazos.
 * El bloqueo duro (409) y su UI llegan en la fase del guardia. Mantener estas
 * funciones libres de efectos hace trivial activarlas mas adelante en el
 * enforcement sin reescribir la logica.
 */

// ---------------------------------------------------------------------------
// Candado por prerrequisitos de curso
// ---------------------------------------------------------------------------
export type CoursePrereq = { requiresId: string; requiresTitle: string };

export type CourseLock = { locked: boolean; lockReason: string | null };

/**
 * Un curso queda bloqueado si tiene prerrequisitos que el usuario aun no ha
 * COMPLETADO. `completedCourseIds` es el conjunto de courseId con inscripcion
 * COMPLETED del usuario. El texto es de cara al estudiante, en espanol.
 */
export function computeCourseLock(
  prerequisites: CoursePrereq[],
  completedCourseIds: Set<string>
): CourseLock {
  const missing = prerequisites.filter((prereq) => !completedCourseIds.has(prereq.requiresId));
  if (missing.length === 0) {
    return { locked: false, lockReason: null };
  }

  const titles = missing.map((prereq) => prereq.requiresTitle);
  const lockReason =
    titles.length === 1
      ? `Completa antes el curso "${titles[0]}" para desbloquear este.`
      : `Completa antes estos cursos para desbloquear este: ${titles.join(", ")}.`;

  return { locked: true, lockReason };
}

// ---------------------------------------------------------------------------
// Bloqueo secuencial de lecciones
// ---------------------------------------------------------------------------
/**
 * Marca cada leccion (en orden de lectura del curso) como `available`/`locked`.
 * Una leccion esta disponible solo si TODAS las anteriores estan completas; la
 * primera siempre esta disponible. `items` debe venir ya ordenado.
 */
export function computeSequentialLessons<T extends { id: string; completed: boolean }>(
  items: T[]
): Array<T & { available: boolean; locked: boolean }> {
  let previousAllComplete = true;
  return items.map((item) => {
    const available = previousAllComplete;
    if (!item.completed) {
      previousAllComplete = false;
    }
    return { ...item, available, locked: !available };
  });
}

// ---------------------------------------------------------------------------
// Candado del examen
// ---------------------------------------------------------------------------
/**
 * El examen del curso queda bloqueado hasta completar TODAS sus lecciones. Un
 * curso sin lecciones no bloquea el examen (nada que exigir).
 */
export function computeExamLocked(totalLessons: number, completedLessons: number): boolean {
  if (totalLessons <= 0) {
    return false;
  }
  return completedLessons < totalLessons;
}

// ---------------------------------------------------------------------------
// Vencimiento de inscripcion
// ---------------------------------------------------------------------------
/** Una inscripcion esta vencida si tiene fecha de expiracion ya pasada. */
export function isEnrollmentExpired(expiresAt: Date | null | undefined, now: Date): boolean {
  return expiresAt != null && expiresAt.getTime() < now.getTime();
}

// ---------------------------------------------------------------------------
// Racha diaria (streak)
// ---------------------------------------------------------------------------
export type StreakState = {
  lastActiveDate: Date | null;
  currentStreak: number;
  now: Date;
};

export type StreakResult = {
  currentStreak: number;
  lastActiveDate: Date;
  /** true si el estado cambio y hay que persistirlo. */
  changed: boolean;
};

/**
 * Diferencia en dias-calendario (hora local del servidor) entre dos fechas.
 * Se normaliza a medianoche local y se redondea para absorber cambios de horario
 * de verano (offsets de +/- 1h). Positivo si `a` es un dia posterior a `b`.
 */
function calendarDaysBetween(a: Date, b: Date): number {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startA - startB) / 86_400_000);
}

/**
 * Calcula la racha tras una actividad "hoy" (la primera vez que se completa una
 * leccion en el dia). Reglas:
 *  - sin actividad previa (null)      => racha = 1
 *  - misma fecha que hoy (delta 0)    => sin cambio
 *  - fue ayer (delta 1)               => racha + 1
 *  - hueco (delta >= 2) o fecha rara  => racha = 1
 * Funcion pura: no lee reloj ni base de datos, todo entra por `input`.
 */
export function computeStreak(input: StreakState): StreakResult {
  const { lastActiveDate, currentStreak, now } = input;

  if (!lastActiveDate) {
    return { currentStreak: 1, lastActiveDate: now, changed: true };
  }

  const delta = calendarDaysBetween(now, lastActiveDate);

  if (delta === 0) {
    return { currentStreak, lastActiveDate, changed: false };
  }

  if (delta === 1) {
    return { currentStreak: currentStreak + 1, lastActiveDate: now, changed: true };
  }

  // Hueco de dos o mas dias, o una fecha previa en el futuro (reloj cambiado):
  // la racha se reinicia a 1.
  return { currentStreak: 1, lastActiveDate: now, changed: true };
}
