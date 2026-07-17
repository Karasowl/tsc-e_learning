import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { isAdmin, requireAuth } from "../lib/auth.js";
import type { AppConfig } from "../lib/config.js";

/**
 * Read-only aggregates that power the admin landing dashboard ("Tablero") and the
 * audit view ("Bitácora"). Every number is derived from live tables via count()/
 * findMany — nothing is fabricated. If a source has no rows, the number is a
 * truthful zero and the activity feed is honestly empty.
 */
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
    const [
      activeCollaborators,
      totalCollaborators,
      invitedCollaborators,
      publishedCourses,
      completedCourses,
      diplomas,
      pendingNotifications,
      recentCerts,
      recentCompletions
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
      activity
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
