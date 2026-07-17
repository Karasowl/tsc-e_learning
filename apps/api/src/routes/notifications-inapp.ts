import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";

const notificationIdSchema = z.object({
  id: z.string().min(1)
});

export function serializeNotification(notification: {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkType: string | null;
  linkId: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    linkType: notification.linkType,
    linkId: notification.linkId,
    read: notification.readAt !== null,
    readAt: notification.readAt,
    createdAt: notification.createdAt
  };
}

/**
 * Rutas de la bandeja in-app (la campana). Cada usuario solo ve y marca sus
 * propias notificaciones: el filtro por `userId` garantiza que nadie pueda leer
 * ni marcar la bandeja de otro.
 */
export async function registerInAppNotificationRoutes(server: FastifyInstance) {
  server.get("/me/notifications", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const [notifications, unreadCount] = await Promise.all([
      getPrisma().notification.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      getPrisma().notification.count({ where: { userId: auth.userId, readAt: null } })
    ]);

    return {
      notifications: notifications.map(serializeNotification),
      unreadCount
    };
  });

  server.post("/me/notifications/:id/read", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const params = notificationIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    // updateMany con el userId en el where evita leer/marcar la bandeja de otro:
    // count 0 significa "no existe o no es tuya".
    const result = await getPrisma().notification.updateMany({
      where: { id: params.data.id, userId: auth.userId, readAt: null },
      data: { readAt: new Date() }
    });

    if (result.count === 0) {
      // Puede ser inexistente/ajena, o ya estaba leída. Distinguimos "no tuya".
      const exists = await getPrisma().notification.findFirst({
        where: { id: params.data.id, userId: auth.userId },
        select: { id: true }
      });
      if (!exists) {
        return reply.code(404).send({ error: "Notification not found" });
      }
    }

    return { read: true };
  });

  server.post("/me/notifications/read-all", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const result = await getPrisma().notification.updateMany({
      where: { userId: auth.userId, readAt: null },
      data: { readAt: new Date() }
    });

    return { updated: result.count };
  });
}
