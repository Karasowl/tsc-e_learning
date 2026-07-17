import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { AppConfig } from "./lib/config.js";
import { startNotificationWorker } from "./lib/notifications-worker.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminOverviewRoutes } from "./routes/admin-overview.js";
import { registerAnnouncementRoutes } from "./routes/announcements.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerCertificateRoutes } from "./routes/certificates.js";
import { registerCertificateTemplateRoutes } from "./routes/certificate-templates.js";
import { registerInAppNotificationRoutes } from "./routes/notifications-inapp.js";
import { registerCourseAdminRoutes } from "./routes/courses-admin.js";
import { registerCourseRoutes } from "./routes/courses.js";
import { registerDirectoryRoutes } from "./routes/directory.js";
import { registerEnrollmentAdminRoutes } from "./routes/enrollments-admin.js";
import { registerGamificationRoutes } from "./routes/gamification.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerQuizAdminRoutes } from "./routes/quizzes-admin.js";
import { registerQuizRoutes } from "./routes/quizzes.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerUserAdminRoutes } from "./routes/users-admin.js";

export async function buildServer(config: AppConfig) {
  const allowedOrigins = new Set<string>([config.webPublicUrl, ...config.corsOrigins]);
  if (config.nodeEnv !== "production") {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001"
    ]) {
      allowedOrigins.add(origin);
    }
  }
  // Allow this project's Vercel deployments (production alias + previews) so the
  // web works before/after the DNS cutover without reconfiguring the API.
  const vercelOrigin = /^https:\/\/tsc-capacita[a-z0-9-]*\.vercel\.app$/;

  const server = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug"
    }
  });

  await server.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || vercelOrigin.test(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    // @fastify/cors v11 defaults to "GET,HEAD,POST" only. The authoring console
    // relies on PUT/PATCH/DELETE (save cover, publish course, edit lessons,
    // delete), so they must be declared explicitly or the browser preflight
    // rejects them ("Method PUT is not allowed by Access-Control-Allow-Methods").
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  });

  await server.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn }
  });

  await server.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 1024
    }
  });

  // Throttle abuse globally; /auth/login overrides with a stricter limit.
  await server.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute"
  });

  await registerAccountRoutes(server);
  await registerAdminOverviewRoutes(server, config);
  await registerAnnouncementRoutes(server);
  await registerAssetRoutes(server, config);
  await registerAuthRoutes(server, config);
  await registerCertificateRoutes(server, config);
  await registerCertificateTemplateRoutes(server);
  await registerCourseAdminRoutes(server);
  await registerCourseRoutes(server);
  await registerDirectoryRoutes(server);
  await registerEnrollmentAdminRoutes(server);
  await registerGamificationRoutes(server);
  await registerHealthRoutes(server);
  await registerInventoryRoutes(server);
  await registerInvitationRoutes(server);
  await registerInAppNotificationRoutes(server);
  await registerNotificationRoutes(server, config);
  await registerQuizAdminRoutes(server);
  await registerQuizRoutes(server);
  await registerReportRoutes(server);
  await registerReviewRoutes(server);
  await registerUserAdminRoutes(server, config);

  const notificationWorker = startNotificationWorker(config, server.log);
  server.addHook("onClose", async () => {
    notificationWorker.stop();
  });

  return server;
}
