import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { isAdmin, requireAuth } from "../lib/auth.js";
import type { AppConfig } from "../lib/config.js";
import { isEnrollmentExpired } from "../lib/gating.js";

/**
 * Read-only aggregates that power the admin landing dashboard ("Tablero") and the
 * audit view ("Bitácora"). Every number is derived from live tables via count()/
 * findMany — nothing is fabricated. If a source has no rows, the number is a
 * truthful zero and the activity feed is honestly empty.
 */

const SIN_LINEA = "Sin línea";
const SIN_SEDE = "Sin sede";

// ---------------------------------------------------------------------------
// Cumplimiento (compliance) — agregación pura y testeable
// ---------------------------------------------------------------------------
/**
 * Una inscripción vista desde el tablero de cumplimiento: a qué línea de servicio
 * pertenece el curso, a qué sede el colaborador, y si está COMPLETADA. `line` y
 * `site` nulos caen en los grupos "Sin línea"/"Sin sede". `completed` es verdadero
 * solo para inscripciones COMPLETED: EXPIRED (y cualquier otro estado) cuenta como
 * no completada.
 */
export type ComplianceEnrollment = {
  line: string | null;
  site: string | null;
  completed: boolean;
};

export type ComplianceGroup = { total: number; completed: number; pct: number };

export type ComplianceByLine = ComplianceGroup & { line: string };
export type ComplianceBySite = ComplianceGroup & { site: string };

export type ComplianceBreakdown = {
  byLine: ComplianceByLine[];
  bySite: ComplianceBySite[];
};

/** total/completed/pct de un grupo. pct = redondeo(completed/total*100), 0 si vacío. */
function foldGroup(total: number, completed: number): ComplianceGroup {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, pct };
}

/**
 * Agrupa las inscripciones por línea de servicio del curso y por sede del
 * colaborador, contando el total y las completadas de cada grupo. Pura y sin E/S
 * para poder probarse sin base de datos. Los grupos se ordenan alfabéticamente por
 * su etiqueta para una salida determinista.
 */
export function aggregateCompliance(enrollments: ComplianceEnrollment[]): ComplianceBreakdown {
  const byLine = new Map<string, { total: number; completed: number }>();
  const bySite = new Map<string, { total: number; completed: number }>();

  const bump = (map: Map<string, { total: number; completed: number }>, key: string, completed: boolean) => {
    const current = map.get(key) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (completed) {
      current.completed += 1;
    }
    map.set(key, current);
  };

  for (const enrollment of enrollments) {
    bump(byLine, enrollment.line ?? SIN_LINEA, enrollment.completed);
    bump(bySite, enrollment.site ?? SIN_SEDE, enrollment.completed);
  }

  const byLineRows: ComplianceByLine[] = [...byLine.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([line, group]) => ({ line, ...foldGroup(group.total, group.completed) }));

  const bySiteRows: ComplianceBySite[] = [...bySite.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([site, group]) => ({ site, ...foldGroup(group.total, group.completed) }));

  return { byLine: byLineRows, bySite: bySiteRows };
}

// ---------------------------------------------------------------------------
// Alerta de gobierno — una sola alerta, la más severa, o null
// ---------------------------------------------------------------------------
export type GovernanceSignals = {
  /** Inscripciones vencidas (status EXPIRED o vencidas por fecha, sin completar). */
  expiredEnrollments: number;
  /** NotificationLog en PENDING: correo encolado aún sin despachar. */
  pendingNotifications: number;
  /** true solo si host + user + password del SMTP están presentes. */
  smtpConfigured: boolean;
  /** Cursos PUBLICADOS sin instructor asignado (teacherId null). */
  publishedCoursesWithoutTeacher: number;
};

export type GovernanceAlert = {
  level: "info" | "warn" | "critical";
  title: string;
  detail: string;
};

/**
 * Elige la única alerta de gobierno a mostrar, la más severa primero, o null si no
 * hay nada que reportar. Pura: recibe señales ya contadas y decide el mensaje.
 *
 * Prioridad:
 *  1. critical — hay correo encolado pero el SMTP no está configurado: esos
 *     correos no se despacharán nunca hasta configurarlo (rotura operativa real).
 *  2. warn — hay inscripciones vencidas: colaboradores que perdieron acceso a su
 *     formación y requieren renovación.
 *  3. warn — hay cursos publicados sin instructor asignado (integridad del
 *     catálogo).
 */
export function computeGovernanceAlert(signals: GovernanceSignals): GovernanceAlert | null {
  if (signals.pendingNotifications > 0 && !signals.smtpConfigured) {
    return {
      level: "critical",
      title: "Correo sin salida configurada",
      detail: `Hay ${signals.pendingNotifications} ${
        signals.pendingNotifications === 1 ? "notificación encolada" : "notificaciones encoladas"
      } que no se despacharán: el envío de correo no está configurado.`
    };
  }

  if (signals.expiredEnrollments > 0) {
    return {
      level: "warn",
      title: "Inscripciones vencidas",
      detail: `Hay ${signals.expiredEnrollments} ${
        signals.expiredEnrollments === 1 ? "inscripción vencida" : "inscripciones vencidas"
      }: esos colaboradores perdieron acceso a su formación y requieren renovación.`
    };
  }

  if (signals.publishedCoursesWithoutTeacher > 0) {
    return {
      level: "warn",
      title: "Cursos sin instructor",
      detail: `Hay ${signals.publishedCoursesWithoutTeacher} ${
        signals.publishedCoursesWithoutTeacher === 1 ? "curso publicado" : "cursos publicados"
      } sin instructor asignado.`
    };
  }

  return null;
}

export async function registerAdminOverviewRoutes(server: FastifyInstance, config: AppConfig) {
  server.get("/admin/overview", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const prisma = getPrisma();
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      activeCollaborators,
      totalCollaborators,
      invitedCollaborators,
      publishedCourses,
      completedCourses,
      diplomas,
      pendingNotifications,
      recentCerts,
      recentCompletions,
      complianceEnrollments,
      catalogCourses,
      auditEvents
    ] = await Promise.all([
      prisma.user.count({ where: { status: "ACTIVE", roles: { some: { role: "STUDENT" } } } }),
      prisma.user.count({ where: { roles: { some: { role: "STUDENT" } } } }),
      prisma.user.count({ where: { status: "INVITED" } }),
      prisma.course.count({ where: { status: "PUBLISHED" } }),
      prisma.enrollment.count({ where: { status: "COMPLETED" } }),
      prisma.certificate.count({ where: { status: "ISSUED" } }),
      // Correo aún sin despachar: NotificationLog en PENDING (el worker los pasa a
      // SENT/FAILED). Es la señal real de "hay correo encolado".
      prisma.notificationLog.count({ where: { status: "PENDING" } }),
      prisma.certificate.findMany({
        where: { status: "ISSUED" },
        orderBy: { issuedAt: "desc" },
        take: 8,
        select: {
          id: true,
          issuedAt: true,
          folio: true,
          user: { select: { displayName: true } },
          course: { select: { title: true } }
        }
      }),
      prisma.enrollment.findMany({
        where: { status: "COMPLETED", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 8,
        select: {
          id: true,
          completedAt: true,
          user: { select: { displayName: true } },
          course: { select: { title: true } }
        }
      }),
      // Todas las inscripciones con la línea del curso y la sede del colaborador,
      // para el cumplimiento y para contar las vencidas de la alerta.
      prisma.enrollment.findMany({
        select: {
          status: true,
          expiresAt: true,
          course: { select: { serviceLine: true } },
          user: { select: { serviceLabel: true } }
        }
      }),
      // Cursos publicados con el estado de sus inscripciones (para el catálogo y
      // para detectar publicados sin instructor).
      prisma.course.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { title: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          teacherId: true,
          enrollments: { select: { status: true } }
        }
      }),
      prisma.auditEvent.findMany({
        where: { createdAt: { gte: since24h } },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { displayName: true } } }
      })
    ]);

    const activity = [
      ...recentCerts.map((cert) => ({
        id: `cert-${cert.id}`,
        kind: "certificate" as const,
        label: "Diploma emitido",
        actor: cert.user.displayName,
        detail: cert.course.title,
        reference: cert.folio,
        at: cert.issuedAt
      })),
      ...recentCompletions.map((enrollment) => ({
        id: `done-${enrollment.id}`,
        kind: "completion" as const,
        label: "Curso completado",
        actor: enrollment.user.displayName,
        detail: enrollment.course.title,
        reference: null,
        at: enrollment.completedAt as Date
      }))
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12);

    // SMTP is "configured" only when host + user + password are all present — the
    // exact condition the email provider requires to send. When false, the worker
    // does not run and pendingNotifications will not drain.
    const smtpConfigured = Boolean(config.smtp.host && config.smtp.user && config.smtp.password);

    const compliance = aggregateCompliance(
      complianceEnrollments.map((enrollment) => ({
        line: enrollment.course.serviceLine,
        site: enrollment.user.serviceLabel,
        completed: enrollment.status === "COMPLETED"
      }))
    );

    const catalog = catalogCourses.map((course) => ({
      id: course.id,
      title: course.title,
      status: course.status,
      enrolled: course.enrollments.length,
      completed: course.enrollments.filter((enrollment) => enrollment.status === "COMPLETED").length
    }));

    // Inscripciones vencidas: status EXPIRED, o vencidas por fecha (expiresAt en el
    // pasado) que todavía no se completaron. Una inscripción ya COMPLETED conserva
    // su formación aprobada, no cuenta como vencida.
    const expiredEnrollments = complianceEnrollments.filter(
      (enrollment) =>
        enrollment.status === "EXPIRED" ||
        (enrollment.status !== "COMPLETED" && isEnrollmentExpired(enrollment.expiresAt, now))
    ).length;

    const publishedCoursesWithoutTeacher = catalogCourses.filter((course) => course.teacherId === null).length;

    const alert = computeGovernanceAlert({
      expiredEnrollments,
      pendingNotifications,
      smtpConfigured,
      publishedCoursesWithoutTeacher
    });

    const bitacora24h = auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      summary: event.summary,
      createdAt: event.createdAt,
      actor: event.actor ? event.actor.displayName : null
    }));

    return {
      kpis: {
        activeCollaborators,
        totalCollaborators,
        invitedCollaborators,
        publishedCourses,
        completedCourses,
        diplomas
      },
      pendingNotifications,
      smtpConfigured,
      activity,
      alert,
      compliance,
      catalog,
      bitacora24h
    };
  });

  server.get("/admin/audit", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const events = await getPrisma().auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { actor: { select: { displayName: true, email: true } } }
    });

    return {
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        summary: event.summary,
        targetType: event.targetType,
        targetId: event.targetId,
        actor: event.actor ? { displayName: event.actor.displayName, email: event.actor.email } : null,
        createdAt: event.createdAt
      }))
    };
  });
}
