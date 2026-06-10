import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import type { Prisma, Role } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth } from "../lib/auth.js";

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

export async function registerUserAdminRoutes(server: FastifyInstance) {
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

    return reply.code(201).send({ user: { ...user, roles: user.roles.map((entry) => entry.role) } });
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

    await getPrisma().userRole.upsert({
      where: { userId_role: { userId: user.id, role: body.data.role } },
      update: {},
      create: { userId: user.id, role: body.data.role }
    });

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

    return { roles: await rolesForUser(params.data.userId) };
  });
}

function dedupeRoles(roles: Role[]): Role[] {
  return Array.from(new Set(roles));
}

async function rolesForUser(userId: string): Promise<Role[]> {
  const rows = await getPrisma().userRole.findMany({
    where: { userId },
    select: { role: true }
  });
  return rows.map((row) => row.role);
}
