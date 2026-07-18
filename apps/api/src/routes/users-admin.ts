import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import type { Prisma, Role } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAdminAction } from "../lib/audit.js";
import { isAdmin, requireAuth } from "../lib/auth.js";
import type { AppConfig } from "../lib/config.js";
import { isEnrollmentExpired } from "../lib/gating.js";
import { rankInfo, totalXp } from "../lib/gamification.js";
import {
  buildActivationUrl,
  deliverInvitationEmail,
  generateInvitationToken,
  INVITATION_TTL_MS
} from "../lib/invitations.js";

const userIdSchema = z.object({ userId: z.string().min(1) });

const roleParamsSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"])
});

const listSchema = z.object({
  q: z.string().trim().optional(),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "INVITED"]).optional()
});

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(6).max(4096),
  serviceLabel: z.string().min(1).optional(),
  roles: z.array(z.enum(["ADMIN", "TEACHER", "STUDENT"])).min(1).optional()
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  serviceLabel: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "DISABLED", "INVITED"]).optional()
});

const assignRoleSchema = z.object({
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"])
});

const inviteUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  serviceLabel: z.string().min(1).optional(),
  roles: z.array(z.enum(["ADMIN", "TEACHER", "STUDENT"])).min(1).optional()
});

export async function registerUserAdminRoutes(server: FastifyInstance, config: AppConfig) {
  // List every user with their roles — the backbone of the roles & permissions admin.
  server.get("/admin/users", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const query = listSchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }

    const where: Prisma.UserWhereInput = {};
    if (query.data.q) {
      where.OR = [
        { displayName: { contains: query.data.q, mode: "insensitive" } },
        { email: { contains: query.data.q, mode: "insensitive" } }
      ];
    }
    if (query.data.role) {
      where.roles = { some: { role: query.data.role } };
    }
    if (query.data.status) {
      where.status = query.data.status;
    }

    const users = await getPrisma().user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: 200,
      select: {
        id: true,
        email: true,
        displayName: true,
        serviceLabel: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: true } }
      }
    });

    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        serviceLabel: user.serviceLabel,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        roles: user.roles.map((entry) => entry.role)
      }))
    };
  });

  // Expediente completo de un usuario: perfil, XP/rango, inscripciones (con
  // vencimiento derivado), certificados, insignias y auditoría reciente sobre él.
  server.get("/admin/users/:userId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = userIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: params.data.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        employeeCode: true,
        serviceLabel: true,
        status: true,
        lastLoginAt: true,
        currentStreak: true,
        createdAt: true,
        roles: { select: { role: true } },
        enrollments: {
          orderBy: { enrolledAt: "desc" },
          select: {
            id: true,
            status: true,
            progressPercent: true,
            enrolledAt: true,
            completedAt: true,
            expiresAt: true,
            course: { select: { id: true, title: true, slug: true } }
          }
        },
        certificates: {
          where: { status: "ISSUED" },
          orderBy: { issuedAt: "desc" },
          select: {
            id: true,
            folio: true,
            issuedAt: true,
            course: { select: { id: true, title: true } }
          }
        },
        achievementAwards: {
          orderBy: { awardedAt: "asc" },
          select: {
            achievementId: true,
            awardedAt: true,
            achievement: { select: { slug: true, title: true, points: true } }
          }
        }
      }
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const [xp, auditEvents] = await Promise.all([
      totalXp(prisma, user.id),
      prisma.auditEvent.findMany({
        where: { targetId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { displayName: true } } }
      })
    ]);

    const now = new Date();

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        employeeCode: user.employeeCode,
        serviceLabel: user.serviceLabel,
        status: user.status,
        roles: user.roles.map((entry) => entry.role),
        lastLoginAt: user.lastLoginAt,
        currentStreak: user.currentStreak,
        createdAt: user.createdAt
      },
      gamification: {
        xp,
        rank: rankInfo(xp)
      },
      enrollments: user.enrollments.map((enrollment) => ({
        id: enrollment.id,
        courseId: enrollment.course.id,
        courseTitle: enrollment.course.title,
        courseSlug: enrollment.course.slug,
        status: enrollment.status,
        progressPercent: enrollment.progressPercent.toNumber(),
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        expiresAt: enrollment.expiresAt,
        expired: isEnrollmentExpired(enrollment.expiresAt, now)
      })),
      certificates: user.certificates.map((certificate) => ({
        id: certificate.id,
        folio: certificate.folio,
        issuedAt: certificate.issuedAt,
        courseId: certificate.course.id,
        courseTitle: certificate.course.title
      })),
      badges: dedupeEarnedBadges(user.achievementAwards),
      auditEvents: auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        summary: event.summary,
        createdAt: event.createdAt,
        actor: event.actor?.displayName ?? null
      }))
    };
  });

  // Create a user with one or more roles (admin, teacher, or student).
  server.post("/admin/users", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const body = createUserSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const email = body.data.email.toLowerCase();
    const existing = await getPrisma().user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    }

    const roles = dedupeRoles(body.data.roles ?? ["STUDENT"]);
    const passwordHash = await hashApplicationPassword(body.data.password);
    const user = await getPrisma().user.create({
      data: {
        email,
        displayName: body.data.displayName,
        serviceLabel: body.data.serviceLabel ?? null,
        status: "ACTIVE",
        passwordHash,
        roles: { create: roles.map((role) => ({ role })) }
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        serviceLabel: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: true } }
      }
    });

    await logAdminAction({
      actorId: auth.userId,
      action: "USER_CREATED",
      summary: `Creó la cuenta de ${user.displayName} (${user.email})`,
      targetType: "user",
      targetId: user.id,
      metadata: { roles },
      logger: request.log
    });

    return reply.code(201).send({ user: { ...user, roles: user.roles.map((entry) => entry.role) } });
  });

  // Invite a user: create the account as INVITED (no password) plus a single-use
  // activation token, then email the link. In non-production (or without SMTP)
  // the send is skipped and the activation URL is returned so the admin can hand
  // it off. This makes the INVITED status reachable for real — no simulation.
  server.post("/admin/users/invite", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const body = inviteUserSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const email = body.data.email.toLowerCase();
    const roles = dedupeRoles(body.data.roles ?? ["STUDENT"]);
    const existing = await getPrisma().user.findUnique({ where: { email }, select: { id: true, status: true } });

    // Re-inviting a still-pending account is fine (refresh + new token). An
    // already-active/suspended account must not be silently re-provisioned.
    if (existing && existing.status !== "INVITED") {
      return reply.code(409).send({ error: "Ya existe una cuenta activa con ese correo" });
    }

    const userSelect = {
      id: true,
      email: true,
      displayName: true,
      serviceLabel: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      roles: { select: { role: true } }
    } satisfies Prisma.UserSelect;

    let user;
    if (existing) {
      await getPrisma().user.update({
        where: { id: existing.id },
        data: {
          displayName: body.data.displayName,
          serviceLabel: body.data.serviceLabel ?? null,
          status: "INVITED"
        }
      });
      for (const role of roles) {
        await getPrisma().userRole.upsert({
          where: { userId_role: { userId: existing.id, role } },
          update: {},
          create: { userId: existing.id, role }
        });
      }
      user = await getPrisma().user.findUniqueOrThrow({ where: { id: existing.id }, select: userSelect });
    } else {
      user = await getPrisma().user.create({
        data: {
          email,
          displayName: body.data.displayName,
          serviceLabel: body.data.serviceLabel ?? null,
          status: "INVITED",
          passwordHash: null,
          roles: { create: roles.map((role) => ({ role })) }
        },
        select: userSelect
      });
    }

    // Invalidate any prior unused token, then mint a fresh one.
    await getPrisma().invitationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    const { raw, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await getPrisma().invitationToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt, createdById: auth.userId }
    });

    const url = buildActivationUrl(config, raw);
    const delivery = await deliverInvitationEmail(
      config,
      { to: email, displayName: user.displayName, url },
      request.log
    );

    await logAdminAction({
      actorId: auth.userId,
      action: "USER_INVITED",
      summary: `Invitó a ${user.displayName} (${user.email})`,
      targetType: "user",
      targetId: user.id,
      metadata: { roles, emailed: delivery.delivered },
      logger: request.log
    });

    return reply.code(201).send({
      user: { ...user, roles: user.roles.map((entry) => entry.role) },
      invitation: {
        emailed: delivery.delivered,
        expiresAt,
        // Only hand back the raw link when it was NOT emailed (dev / skipped /
        // failed) so the admin has a fallback; never leak a live token when the
        // real email already carried it.
        activationUrl: delivery.delivered ? null : url
      }
    });
  });

  // Update profile / status (e.g. suspend an account).
  server.put("/admin/users/:userId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = userIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const body = updateUserSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const user = await getPrisma().user.findUnique({ where: { id: params.data.userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    // Guard against an admin disabling their own account and locking themselves out.
    if (params.data.userId === auth.userId && body.data.status && body.data.status !== "ACTIVE") {
      return reply.code(400).send({ error: "No puedes desactivar tu propia cuenta" });
    }

    // Una cuenta sin NINGUNA credencial utilizable (ni passwordHash ni hash
    // legado) no puede pasarse a ACTIVE a mano: no tendría forma de iniciar
    // sesión y activar el estado invalida el flujo de invitación (que exige
    // status INVITED). Hoy solo los invitados sin activar carecen de ambos, y el
    // chequeo por credenciales cierra también el rodeo INVITED→DISABLED→ACTIVE.
    if (
      blocksManualActivation({
        passwordHash: user.passwordHash,
        legacyPasswordHash: user.legacyPasswordHash,
        nextStatus: body.data.status
      })
    ) {
      return reply.code(409).send({ error: "Esta cuenta aún no ha activado su acceso. Reenvía la invitación." });
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.data.displayName !== undefined) {
      data.displayName = body.data.displayName;
    }
    if (body.data.serviceLabel !== undefined) {
      data.serviceLabel = body.data.serviceLabel;
    }
    if (body.data.status !== undefined) {
      data.status = body.data.status;
    }

    const updated = await getPrisma().user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        email: true,
        displayName: true,
        serviceLabel: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: true } }
      }
    });

    if (body.data.status !== undefined && body.data.status !== user.status) {
      const verb = body.data.status === "DISABLED" ? "Suspendió" : body.data.status === "ACTIVE" ? "Reactivó" : "Actualizó";
      await logAdminAction({
        actorId: auth.userId,
        action: "USER_STATUS_CHANGED",
        summary: `${verb} la cuenta de ${updated.displayName} (${updated.email})`,
        targetType: "user",
        targetId: updated.id,
        metadata: { from: user.status, to: body.data.status },
        logger: request.log
      });
    }

    return { user: { ...updated, roles: updated.roles.map((entry) => entry.role) } };
  });

  // Grant a role (idempotent).
  server.post("/admin/users/:userId/roles", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = userIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const body = assignRoleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const user = await getPrisma().user.findUnique({ where: { id: params.data.userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const alreadyHadRole = await getPrisma().userRole.findUnique({
      where: { userId_role: { userId: user.id, role: body.data.role } }
    });
    await getPrisma().userRole.upsert({
      where: { userId_role: { userId: user.id, role: body.data.role } },
      update: {},
      create: { userId: user.id, role: body.data.role }
    });

    if (!alreadyHadRole) {
      await logAdminAction({
        actorId: auth.userId,
        action: "USER_ROLE_GRANTED",
        summary: `Asignó el rol ${body.data.role} a ${user.displayName} (${user.email})`,
        targetType: "user",
        targetId: user.id,
        metadata: { role: body.data.role },
        logger: request.log
      });
    }

    return reply.code(201).send({ roles: await rolesForUser(user.id) });
  });

  // Revoke a role. Cannot remove the user's last role, and an admin cannot strip
  // their own ADMIN role (which would lock them out of this very panel).
  server.delete("/admin/users/:userId/roles/:role", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = roleParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    if (params.data.userId === auth.userId && params.data.role === "ADMIN") {
      return reply.code(400).send({ error: "No puedes quitarte tu propio rol de administrador" });
    }

    const current = await rolesForUser(params.data.userId);
    if (current.length === 0) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (!current.includes(params.data.role)) {
      return reply.code(404).send({ error: "El usuario no tiene ese rol" });
    }
    if (current.length === 1) {
      return reply.code(400).send({ error: "El usuario debe conservar al menos un rol" });
    }

    await getPrisma().userRole.delete({
      where: { userId_role: { userId: params.data.userId, role: params.data.role } }
    });

    const target = await getPrisma().user.findUnique({
      where: { id: params.data.userId },
      select: { displayName: true, email: true }
    });
    await logAdminAction({
      actorId: auth.userId,
      action: "USER_ROLE_REVOKED",
      summary: `Retiró el rol ${params.data.role} de ${target?.displayName ?? "un usuario"}${target?.email ? ` (${target.email})` : ""}`,
      targetType: "user",
      targetId: params.data.userId,
      metadata: { role: params.data.role },
      logger: request.log
    });

    return { roles: await rolesForUser(params.data.userId) };
  });
}

function dedupeRoles(roles: Role[]): Role[] {
  return Array.from(new Set(roles));
}

/**
 * Decide si el cambio manual de estado debe rechazarse: pasar a ACTIVE una
 * cuenta sin ninguna credencial utilizable (ni passwordHash ni hash legado de
 * WordPress) la dejaría "activa" pero sin forma de iniciar sesión, y además
 * rompería su activación por invitación (que exige status INVITED). Se decide
 * por credenciales y no por el estado actual para cerrar también el rodeo
 * INVITED→DISABLED→ACTIVE. Hoy solo los invitados sin activar carecen de ambos
 * hashes, así que no afecta cuentas migradas ni cuentas ya activas. Pura para
 * poder probarse sin base de datos.
 */
export function blocksManualActivation(input: {
  passwordHash: string | null;
  legacyPasswordHash: string | null;
  nextStatus: string | undefined;
}): boolean {
  return input.nextStatus === "ACTIVE" && input.passwordHash === null && input.legacyPasswordHash === null;
}

export type EarnedBadge = { slug: string; title: string; points: number; awardedAt: Date };

/**
 * Colapsa los awards de un usuario a una insignia por logro, conservando la
 * fecha de obtención más antigua (puede haber varios awards migrados por el mismo
 * logro). Puro, para poder probarlo sin base de datos.
 */
export function dedupeEarnedBadges(
  awards: Array<{ achievementId: string; awardedAt: Date; achievement: { slug: string; title: string; points: number } }>
): EarnedBadge[] {
  const byAchievement = new Map<string, EarnedBadge>();
  for (const award of awards) {
    const current = byAchievement.get(award.achievementId);
    if (!current || award.awardedAt < current.awardedAt) {
      byAchievement.set(award.achievementId, {
        slug: award.achievement.slug,
        title: award.achievement.title,
        points: award.achievement.points,
        awardedAt: award.awardedAt
      });
    }
  }
  return Array.from(byAchievement.values());
}

async function rolesForUser(userId: string): Promise<Role[]> {
  const rows = await getPrisma().userRole.findMany({
    where: { userId },
    select: { role: true }
  });
  return rows.map((row) => row.role);
}
