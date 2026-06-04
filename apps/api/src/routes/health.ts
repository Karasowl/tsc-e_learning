import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(server: FastifyInstance) {
  server.get("/health", async () => {
    return {
      ok: true,
      service: "tsc-capacita-api",
      time: new Date().toISOString()
    };
  });

  server.get("/health/db", async (_request, reply) => {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      return {
        ok: true,
        database: "reachable"
      };
    } catch (error) {
      server.log.error(error);
      return reply.code(503).send({
        ok: false,
        database: "unreachable"
      });
    }
  });
}
