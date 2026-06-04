import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { AppConfig } from "./lib/config.js";
import { startNotificationWorker } from "./lib/notifications-worker.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCertificateRoutes } from "./routes/certificates.js";
import { registerCourseRoutes } from "./routes/courses.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerQuizRoutes } from "./routes/quizzes.js";
import { registerReportRoutes } from "./routes/reports.js";

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
    credentials: true
  });

  await server.register(jwt, {
    secret: config.jwtSecret
  });

  await server.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 1024
    }
  });

  await registerAuthRoutes(server);
  await registerCertificateRoutes(server, config);
  await registerCourseRoutes(server);
  await registerHealthRoutes(server);
  await registerInventoryRoutes(server);
  await registerNotificationRoutes(server, config);
  await registerQuizRoutes(server);
  await registerReportRoutes(server);

  const notificationWorker = startNotificationWorker(config, server.log);
  server.addHook("onClose", async () => {
    notificationWorker.stop();
  });

  return server;
}
