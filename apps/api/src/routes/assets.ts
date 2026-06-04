import { randomUUID } from "node:crypto";
import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import { LocalStorageProvider } from "../lib/storage.js";
import { isTeacherOrAdmin, requireAuth } from "../lib/auth.js";

const assetFileParamsSchema = z.object({
  assetId: z.string().min(1)
});

export async function registerAssetRoutes(server: FastifyInstance, config: AppConfig) {
  server.post("/assets", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "File is required" });
    }

    const bytes = await data.toBuffer();
    const storageKey = "authored/" + randomUUID() + "/" + sanitizeFileName(data.filename);
    const provider = new LocalStorageProvider(config.localStorageRoot);
    const stored = await provider.putObject({ key: storageKey, bytes });

    const asset = await getPrisma().asset.create({
      data: {
        title: data.filename,
        mimeType: data.mimetype,
        storageKey: stored.key,
        checksum: stored.checksum,
        sizeBytes: BigInt(stored.sizeBytes)
      }
    });

    return reply.code(201).send({ asset: serializeAsset(asset) });
  });

  server.get("/assets/:assetId/file", async (request, reply) => {
    const parsed = assetFileParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const asset = await getPrisma().asset.findUnique({
      where: { id: parsed.data.assetId }
    });

    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    const provider = new LocalStorageProvider(config.localStorageRoot);
    const bytes = await provider.getObject(asset.storageKey);

    return reply.header("content-type", asset.mimeType ?? "application/octet-stream").send(bytes);
  });
}

function sanitizeFileName(filename: string) {
  return filename.replaceAll("\\", "/").split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function serializeAsset(asset: {
  id: string;
  title: string;
  mimeType: string | null;
  storageKey: string;
  checksum: string | null;
  sizeBytes: bigint | null;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    title: asset.title,
    mimeType: asset.mimeType,
    storageKey: asset.storageKey,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes === null ? null : Number(asset.sizeBytes),
    createdAt: asset.createdAt
  };
}
