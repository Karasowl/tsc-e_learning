import { getPrisma } from "@tsc-capacita/db";
import {
  hashApplicationPassword,
  verifyWordPressPassword
} from "@tsc-capacita/wp-compat";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(4096)
});

export async function registerAuthRoutes(server: FastifyInstance) {
  server.post("/auth/login", async (request, reply) => {
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
}
