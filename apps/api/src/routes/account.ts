import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword, verifyWordPressPassword } from "@tsc-capacita/wp-compat";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth } from "../lib/auth.js";

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  serviceLabel: z.string().max(160).nullable().optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(4096),
  newPassword: z.string().min(8).max(4096)
});

const adminResetSchema = z.object({
  newPassword: z.string().min(8).max(4096)
});

export async function registerAccountRoutes(server: FastifyInstance) {
  // ---- Perfil propio ----
  server.get("/me", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    const user = await getPrisma().user.findUnique({
      where: { id: auth.userId },
      include: { roles: true }
    });
    if (!user) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        serviceLabel: user.serviceLabel,
        status: user.status,
        roles: user.roles.map((role) => role.role),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      }
    };
  });

  server.put("/me", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    const parsed = updateMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const data = {
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName.trim() } : {}),
      ...(parsed.data.serviceLabel !== undefined
        ? { serviceLabel: parsed.data.serviceLabel?.trim() || null }
        : {})
    };
    const user = await getPrisma().user.update({
      where: { id: auth.userId },
      data,
      include: { roles: true }
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        serviceLabel: user.serviceLabel,
        status: user.status,
        roles: user.roles.map((role) => role.role)
      }
    };
  });

  // ---- Cambio de contraseña propio ----
  server.post("/me/password", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const user = await getPrisma().user.findUnique({ where: { id: auth.userId } });
    if (!user) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    const hashToCheck = user.passwordHash ?? user.legacyPasswordHash;
    if (!hashToCheck) {
      return reply.code(400).send({ error: "La cuenta no tiene una contraseña configurada" });
    }
    const check = await verifyWordPressPassword(parsed.data.currentPassword, hashToCheck);
    if (!check.ok) {
      return reply.code(400).send({ error: "La contraseña actual no es correcta" });
    }
    await getPrisma().user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashApplicationPassword(parsed.data.newPassword),
        legacyPasswordHash: null,
        legacyPasswordAlgo: null
      }
    });
    return { ok: true };
  });

  // ---- Reset de contraseña por administrador ----
  server.post("/admin/users/:userId/password", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Solo un administrador puede restablecer contraseñas" });
    }
    const parsed = adminResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { userId } = request.params as { userId: string };
    const target = await getPrisma().user.findUnique({ where: { id: userId } });
    if (!target) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    await getPrisma().user.update({
      where: { id: target.id },
      data: {
        passwordHash: await hashApplicationPassword(parsed.data.newPassword),
        legacyPasswordHash: null,
        legacyPasswordAlgo: null
      }
    });
    return { ok: true };
  });
}
