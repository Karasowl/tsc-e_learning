import { getPrisma } from "@tsc-capacita/db";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAdminAction } from "../lib/audit.js";
import { hashInvitationToken, invitationState } from "../lib/invitations.js";

const tokenParamsSchema = z.object({ token: z.string().min(10) });
const activateSchema = z.object({ password: z.string().min(8).max(4096) });

/**
 * Resolve a raw invitation token to its live record. Returns null when the token
 * is unknown, already used, or expired — the three ways an invitation dies.
 */
async function findValidInvitation(rawToken: string) {
  const tokenHash = hashInvitationToken(rawToken);
  const record = await getPrisma().invitationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, displayName: true, status: true } } }
  });
  if (!record || invitationState(record) !== "valid") {
    return null;
  }
  return record;
}

/**
 * PUBLIC endpoints (no auth) that let an INVITED user activate their account by
 * setting a password. Turns the previously-unreachable INVITED status into a
 * real, end-to-end flow.
 */
export async function registerInvitationRoutes(server: FastifyInstance) {
  // Validate a token so the activation page can greet the invitee by name.
  server.get(
    "/auth/invitation/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = tokenParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: params.error.flatten() });
      }

      const record = await findValidInvitation(params.data.token);
      if (!record || record.user.status !== "INVITED") {
        return reply.code(404).send({ error: "La invitación no es válida o ya expiró." });
      }

      return {
        invitation: {
          email: record.user.email,
          displayName: record.user.displayName,
          expiresAt: record.expiresAt
        }
      };
    }
  );

  // Set the password, flip the account to ACTIVE, burn the token, and return a
  // session so the invitee lands logged in.
  server.post(
    "/auth/invitation/:token/activate",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = tokenParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: params.error.flatten() });
      }
      const body = activateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }

      const record = await findValidInvitation(params.data.token);
      if (!record) {
        return reply.code(410).send({ error: "La invitación no es válida o ya expiró." });
      }
      if (record.user.status !== "INVITED") {
        return reply.code(409).send({ error: "Esta cuenta ya está activa. Inicia sesión con tu contraseña." });
      }

      const passwordHash = await hashApplicationPassword(body.data.password);
      const now = new Date();
      await getPrisma().$transaction([
        getPrisma().user.update({
          where: { id: record.userId },
          data: { status: "ACTIVE", passwordHash, legacyPasswordHash: null, legacyPasswordAlgo: null, lastLoginAt: now }
        }),
        getPrisma().invitationToken.update({ where: { id: record.id }, data: { usedAt: now } })
      ]);

      const user = await getPrisma().user.findUnique({
        where: { id: record.userId },
        include: { roles: true }
      });
      if (!user) {
        return reply.code(410).send({ error: "La invitación no es válida o ya expiró." });
      }

      const roles = user.roles.map((entry) => entry.role);
      const token = server.jwt.sign({ sub: user.id, roles });

      await logAdminAction({
        actorId: user.id,
        action: "USER_INVITE_ACTIVATED",
        summary: `${user.displayName} activó su cuenta desde una invitación`,
        targetType: "user",
        targetId: user.id,
        logger: request.log
      });

      return {
        token,
        user: { id: user.id, email: user.email, displayName: user.displayName, roles }
      };
    }
  );
}
