import bcrypt from "bcryptjs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PHPASS_ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type WordPressPasswordAlgorithm =
  | "wordpress-bcrypt"
  | "phpass"
  | "bcrypt"
  | "md5"
  | "unsupported";

export type WordPressPasswordCheck = {
  ok: boolean;
  algorithm: WordPressPasswordAlgorithm;
  needsRehash: boolean;
};

export async function verifyWordPressPassword(
  password: string,
  storedHash: string
): Promise<WordPressPasswordCheck> {
  if (password.length > 4096) {
    return { ok: false, algorithm: "unsupported", needsRehash: false };
  }

  if (/^[a-f0-9]{32}$/i.test(storedHash)) {
    return {
      ok: safeEqualHex(md5(password), storedHash),
      algorithm: "md5",
      needsRehash: true
    };
  }

  if (storedHash.startsWith("$wp")) {
    const passwordToVerify = createHmac("sha384", "wp-sha384")
      .update(password)
      .digest("base64");

    return {
      ok: await bcrypt.compare(passwordToVerify, normalizeBcryptPrefix(storedHash.slice(3))),
      algorithm: "wordpress-bcrypt",
      needsRehash: true
    };
  }

  if (storedHash.startsWith("$P$") || storedHash.startsWith("$H$")) {
    return {
      ok: verifyPhpPass(password, storedHash),
      algorithm: "phpass",
      needsRehash: true
    };
  }

  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return {
      ok: await bcrypt.compare(password, normalizeBcryptPrefix(storedHash)),
      algorithm: "bcrypt",
      needsRehash: true
    };
  }

  return { ok: false, algorithm: "unsupported", needsRehash: false };
}

export async function hashApplicationPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPhpPass(password: string, storedHash: string): boolean {
  const calculated = hashPhpPass(password, storedHash);

  if (!calculated || calculated.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(calculated), Buffer.from(storedHash));
}

export function hashPhpPass(password: string, setting: string): string | null {
  if (setting.length < 12) {
    return null;
  }

  const countLog2 = PHPASS_ITOA64.indexOf(setting[3] ?? "");
  if (countLog2 < 7 || countLog2 > 30) {
    return null;
  }

  const salt = setting.slice(4, 12);
  if (salt.length !== 8) {
    return null;
  }

  const count = 1 << countLog2;
  let hash = md5Binary(`${salt}${password}`);

  for (let i = 0; i < count; i += 1) {
    hash = md5Buffer(Buffer.concat([hash, Buffer.from(password, "utf8")]));
  }

  return setting.slice(0, 12) + encode64(hash, 16);
}

function normalizeBcryptPrefix(hash: string) {
  if (hash.startsWith("$2y$")) {
    return `$2b$${hash.slice(4)}`;
  }

  return hash;
}

function md5(input: string) {
  return createHash("md5").update(input, "utf8").digest("hex");
}

function md5Binary(input: string) {
  return createHash("md5").update(input, "utf8").digest();
}

function md5Buffer(input: Buffer) {
  return createHash("md5").update(input).digest();
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left.toLowerCase(), "hex");
  const rightBuffer = Buffer.from(right.toLowerCase(), "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function encode64(input: Buffer, count: number) {
  let output = "";
  let i = 0;

  do {
    let value = input[i++] ?? 0;
    output += PHPASS_ITOA64[value & 0x3f] ?? "";

    if (i < count) {
      value |= (input[i] ?? 0) << 8;
    }

    output += PHPASS_ITOA64[(value >> 6) & 0x3f] ?? "";

    if (i++ >= count) {
      break;
    }

    if (i < count) {
      value |= (input[i] ?? 0) << 16;
    }

    output += PHPASS_ITOA64[(value >> 12) & 0x3f] ?? "";

    if (i++ >= count) {
      break;
    }

    output += PHPASS_ITOA64[(value >> 18) & 0x3f] ?? "";
  } while (i < count);

  return output;
}
