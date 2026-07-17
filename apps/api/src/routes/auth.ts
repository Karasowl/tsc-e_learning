import { getPrisma } from "@tsc-capacita/db";
import {
  hashApplicationPassword,
  verifyWordPressPassword
} from "@tsc-capacita/wp-compat";
import type { FastifyInstance } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(4096)
});

const googleSchema = z.object({
  credential: z.string().min(1)
});

export async function registerAuthRoutes(server: FastifyInstance, config: AppConfig) {
  server.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const user = await getPrisma().user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      include: { roles: true }
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const hashToCheck = user.passwordHash ?? user.legacyPasswordHash;
    if (!hashToCheck) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const check = await verifyWordPressPassword(parsed.data.password, hashToCheck);
    if (!check.ok) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    if (check.needsRehash || user.legacyPasswordHash) {
      await getPrisma().user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashApplicationPassword(parsed.data.password),
          legacyPasswordHash: null,
          legacyPasswordAlgo: user.legacyPasswordHash ? check.algorithm : user.legacyPasswordAlgo,
          lastLoginAt: new Date()
        }
      });
    } else {
      await getPrisma().user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
    }

    const roles = user.roles.map((role) => role.role);
    const token = server.jwt.sign({
      sub: user.id,
      roles
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles
      }
    };
  });

  // Sign-in with Google: only existing, active accounts (admin-provisioned) may
  // enter — Google is just an alternate way to authenticate, not self-signup.
  //
  // The route is ALWAYS registered. When no Google client id is configured it
  // answers 503 (service unavailable) with a clear message, so the frontend can
  // distinguish "Google sign-in is off" from a 404 that looks like a broken build.
  const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
  server.post(
    "/auth/google",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!config.googleClientId || !googleClient) {
        return reply
          .code(503)
          .send({ error: "El inicio de sesión con Google no está configurado en este servidor." });
      }

      const parsed = googleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      let email: string | undefined;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: parsed.data.credential,
          audience: config.googleClientId
        });
        const tokenPayload = ticket.getPayload();
        if (tokenPayload?.email && tokenPayload.email_verified) {
          email = tokenPayload.email.toLowerCase();
        }
      } catch {
        return reply.code(401).send({ error: "No se pudo validar la cuenta de Google" });
      }

      if (!email) {
        return reply.code(401).send({ error: "La cuenta de Google no tiene un correo verificado" });
      }

      const user = await getPrisma().user.findUnique({
        where: { email },
        include: { roles: true }
      });

      if (!user || user.status !== "ACTIVE") {
        return reply
          .code(403)
          .send({ error: "Esta cuenta de Google no tiene acceso. Pídele acceso a tu administrador." });
      }

      await getPrisma().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const roles = user.roles.map((role) => role.role);
      const token = server.jwt.sign({ sub: user.id, roles });

      return {
        token,
        user: { id: user.id, email: user.email, displayName: user.displayName, roles }
      };
    }
  );
}
