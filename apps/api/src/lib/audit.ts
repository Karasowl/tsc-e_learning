import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";

/**
 * Canonical set of audited privileged actions. Kept as a string union (the DB
 * column is a plain String) so adding a new action never needs a migration.
 */
export type AuditActionName =
  | "USER_CREATED"
  | "USER_INVITED"
  | "USER_INVITE_ACTIVATED"
  | "USER_STATUS_CHANGED"
  | "USER_ROLE_GRANTED"
  | "USER_ROLE_REVOKED"
  | "USER_PASSWORD_RESET"
  | "ENROLLMENT_GRANTED"
  | "ENROLLMENT_REVOKED";

type AuditLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * Best-effort append to the audit trail. Auditing must never break the mutation
 * it records, so any failure is swallowed (and logged if a logger is provided).
 */
export async function logAdminAction(input: {
  actorId: string | null;
  action: AuditActionName;
  summary: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  logger?: AuditLogger;
}): Promise<void> {
  try {
    await getPrisma().auditEvent.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        summary: input.summary,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      }
    });
  } catch (error) {
    input.logger?.warn({ err: error, action: input.action }, "No se pudo registrar el evento de auditoría");
  }
}
