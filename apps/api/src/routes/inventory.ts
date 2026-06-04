import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createEvidenceSchema = z.object({
  area: z.string().min(1),
  feature: z.string().min(1),
  status: z.enum(["CONFIRMED", "CONFIGURED", "UNUSED", "UNKNOWN"]).default("UNKNOWN"),
  evidence: z.string().optional(),
  sourcePath: z.string().optional()
});

export async function registerInventoryRoutes(server: FastifyInstance) {
  server.get("/inventory/features", async () => {
    const features = await getPrisma().featureEvidence.findMany({
      orderBy: [{ area: "asc" }, { feature: "asc" }]
    });

    return { features };
  });

  server.post("/inventory/features", async (request, reply) => {
    const parsed = createEvidenceSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const feature = await getPrisma().featureEvidence.create({
      data: {
        area: parsed.data.area,
        feature: parsed.data.feature,
        status: parsed.data.status,
        evidence: parsed.data.evidence ?? null,
        sourcePath: parsed.data.sourcePath ?? null
      }
    });

    return reply.code(201).send({ feature });
  });
}
