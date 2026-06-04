import type { Role } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type AuthContext = {
  userId: string;
  roles: Role[];
};

type JwtPayload = {
  sub?: string;
  roles?: string[];
};

const ROLE_VALUES: Role[] = ["ADMIN", "TEACHER", "STUDENT"];

export async function requireAuth(
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthContext | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Authentication required" });
    return null;
  }

  try {
    const payload = await server.jwt.verify<JwtPayload>(header.slice("Bearer ".length));
    if (!payload.sub) {
      reply.code(401).send({ error: "Invalid token" });
      return null;
    }

    return {
      userId: payload.sub,
      roles: (payload.roles ?? []).filter((role): role is Role => ROLE_VALUES.includes(role as Role))
    };
  } catch {
    reply.code(401).send({ error: "Invalid token" });
    return null;
  }
}

export function hasAnyRole(auth: AuthContext, roles: Role[]) {
  return roles.some((role) => auth.roles.includes(role));
}

export function isAdmin(auth: AuthContext) {
  return auth.roles.includes("ADMIN");
}

export function isTeacherOrAdmin(auth: AuthContext) {
  return hasAnyRole(auth, ["ADMIN", "TEACHER"]);
}
