import { getPrisma } from "@tsc-capacita/db";
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

  let payload: JwtPayload;
  try {
    payload = await server.jwt.verify<JwtPayload>(header.slice("Bearer ".length));
  } catch {
    reply.code(401).send({ error: "Invalid token" });
    return null;
  }

  if (!payload.sub) {
    reply.code(401).send({ error: "Invalid token" });
    return null;
  }

  // Revalidate against the live record so revoked roles / suspended accounts
  // lose access immediately instead of only when their token finally expires.
  const user = await getPrisma().user.findUnique({
    where: { id: payload.sub },
    include: { roles: true }
  });

  if (!user || user.status !== "ACTIVE") {
    reply.code(401).send({ error: "Session no longer valid" });
    return null;
  }

  return {
    userId: user.id,
    roles: user.roles.map((entry) => entry.role)
  };
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
