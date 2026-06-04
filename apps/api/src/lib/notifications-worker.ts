import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import { SmtpEmailProvider } from "./email.js";
import { processPendingNotifications } from "./notifications.js";

export type NotificationWorker = {
  stop: () => void;
};

const NOOP: NotificationWorker = { stop: () => {} };

// In-process scheduled worker that periodically delivers PENDING notification
// logs through SMTP. Kept in-process (no Redis/extra container) so the backend
// stays portable to any VPS. Disable it (NOTIFICATIONS_WORKER_ENABLED=false) to
// run delivery elsewhere (a separate process or external cron hitting
// POST /notifications/process), since both share the same processing function.
export function startNotificationWorker(
  config: AppConfig,
  logger: FastifyBaseLogger
): NotificationWorker {
  const { enabled, intervalMs, batch } = config.notificationsWorker;

  if (!enabled) {
    logger.info("Notification worker disabled (NOTIFICATIONS_WORKER_ENABLED=false)");
    return NOOP;
  }

  const smtpReady = Boolean(config.smtp.host && config.smtp.user && config.smtp.password);
  if (!smtpReady) {
    logger.warn("Notification worker not started: SMTP is not configured");
    return NOOP;
  }

  const provider = new SmtpEmailProvider(config.smtp);
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await processPendingNotifications(provider, { limit: batch });
      if (result.processed > 0) {
        logger.info(result, "Notification worker processed pending notifications");
      }
    } catch (error) {
      logger.error({ err: error }, "Notification worker tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Do not keep the process alive just for the worker timer.
  timer.unref();

  logger.info({ intervalMs, batch }, "Notification worker started");

  return {
    stop: () => clearInterval(timer)
  };
}
