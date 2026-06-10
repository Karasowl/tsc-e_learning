import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredObject = {
  key: string;
  checksum: string;
  sizeBytes: number;
};

export interface StorageProvider {
  putObject(input: {
    key: string;
    bytes: Buffer;
  }): Promise<StoredObject>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  async putObject(input: { key: string; bytes: Buffer }): Promise<StoredObject> {
    const safeKey = input.key.replaceAll("\\", "/").replace(/^\/+/, "");
    const fullPath = path.join(this.root, safeKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.bytes);

    return {
      key: safeKey,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      sizeBytes: input.bytes.byteLength
    };
  }

  async getObject(key: string): Promise<Buffer> {
    const safeKey = key.replaceAll("\\", "/").replace(/^\/+/, "");
    const fullPath = path.join(this.root, safeKey);
    return readFile(fullPath);
  }

  async deleteObject(key: string): Promise<void> {
    const safeKey = key.replaceAll("\\", "/").replace(/^\/+/, "");
    const fullPath = path.join(this.root, safeKey);
    try {
      await unlink(fullPath);
    } catch (error) {
      // Missing file is fine — the goal is that the blob no longer exists.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
