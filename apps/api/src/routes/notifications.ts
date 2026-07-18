import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import { logAdminAction } from "../lib/audit.js";
import { SmtpEmailProvider } from "../lib/email.js";
import { processPendingNotifications } from "../lib/notifications.js";
import { isAdmin, requireAuth } from "../lib/auth.js";

const notificationRuleSchema = z.object({
  eventType: z.enum(["QUIZ_PASSED", "QUIZ_FAILED", "COURSE_COMPLETED", "CERTIFICATE_ISSUED"]),
  recipients: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  enabled: z.boolean().default(true)
});

// Edición parcial de una regla: destinatarios, asunto y encendido/apagado. El
// eventType no se cambia (para eso se crea otra regla). Exportado para test.
export const updateNotificationRuleSchema = z
  .object({
    recipients: z.array(z.string().email()).min(1).optional(),
    subject: z.string().min(1).optional(),
    enabled: z.boolean().optional()
  })
  .refine((value) => value.recipients !== undefined || value.subject !== undefined || value.enabled !== undefined, {
    message: "Indica al menos un campo para actualizar"
  });

const ruleIdSchema = z.object({
  id: z.string().min(1)
});

const processQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional()
});

export async function registerNotificationRoutes(server: FastifyInstance, config: AppConfig) {
  server.get("/notifications/rules", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const rules = await getPrisma().notificationRule.findMany({
      orderBy: [{ eventType: "asc" }, { createdAt: "desc" }]
    });

    return { rules };
  });

  server.post("/notifications/rules", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const parsed = notificationRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const rule = await getPrisma().notificationRule.create({
      data: parsed.data
    });

    return reply.code(201).send({ rule });
  });

  server.put("/notifications/rules/:id", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = ruleIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const body = updateNotificationRuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const existing = await getPrisma().notificationRule.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return reply.code(404).send({ error: "No se encontró la regla" });
    }

    const data: Prisma.NotificationRuleUpdateInput = {};
    if (body.data.recipients !== undefined) {
      data.recipients = body.data.recipients;
    }
    if (body.data.subject !== undefined) {
      data.subject = body.data.subject;
    }
    if (body.data.enabled !== undefined) {
      data.enabled = body.data.enabled;
    }

    const rule = await getPrisma().notificationRule.update({
      where: { id: existing.id },
      data
    });

    await logAdminAction({
      actorId: auth.userId,
      action: "NOTIFICATION_RULE_UPDATED",
      summary: `Actualizó la regla de correo del evento ${rule.eventType}`,
      targetType: "notificationRule",
      targetId: rule.id,
      metadata: {
        ...(body.data.recipients !== undefined ? { recipients: body.data.recipients } : {}),
        ...(body.data.subject !== undefined ? { subject: body.data.subject } : {}),
        ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {})
      },
      logger: request.log
    });

    return { rule };
  });

  server.delete("/notifications/rules/:id", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = ruleIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const existing = await getPrisma().notificationRule.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return reply.code(404).send({ error: "No se encontró la regla" });
    }

    await getPrisma().notificationRule.delete({ where: { id: existing.id } });

    await logAdminAction({
      actorId: auth.userId,
      action: "NOTIFICATION_RULE_DELETED",
      summary: `Eliminó la regla de correo del evento ${existing.eventType}`,
      targetType: "notificationRule",
      targetId: existing.id,
      metadata: { eventType: existing.eventType, recipients: existing.recipients },
      logger: request.log
    });

    return reply.code(204).send();
  });

  server.get("/notifications/logs", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const logs = await getPrisma().notificationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return { logs };
  });

  server.post("/notifications/process", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const parsed = processQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const provider = new SmtpEmailProvider(config.smtp);
    const options = parsed.data.limit ? { limit: parsed.data.limit } : {};
    const result = await processPendingNotifications(provider, options);
    return { result };
  });

  server.post("/notifications/retry", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    // Re-queue failed deliveries so the worker (or manual process) retries them.
    // Useful after a transient SMTP outage marked logs as FAILED.
    const { count } = await getPrisma().notificationLog.updateMany({
      where: { status: "FAILED" },
      data: { status: "PENDING" }
    });

    return { requeued: count };
  });
}
