import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import { SmtpEmailProvider } from "../lib/email.js";
import { processPendingNotifications } from "../lib/notifications.js";
import { isAdmin, requireAuth } from "../lib/auth.js";

const notificationRuleSchema = z.object({
  eventType: z.enum(["QUIZ_PASSED", "QUIZ_FAILED", "COURSE_COMPLETED", "CERTIFICATE_ISSUED"]),
  recipients: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  enabled: z.boolean().default(true)
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
}
