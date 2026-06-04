import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import {
  hashApplicationPassword,
  hashPhpPass,
  verifyPhpPass,
  verifyWordPressPassword
} from "./passwords.js";
import { createHmac } from "node:crypto";

describe("WordPress password compatibility", () => {
  it("verifies legacy phpass hashes", async () => {
    const hash = hashPhpPass("secret-password", "$P$B12345678");
    assert.equal(typeof hash, "string");
    assert.equal(verifyPhpPass("secret-password", hash!), true);
    assert.equal(verifyPhpPass("wrong-password", hash!), false);

    const result = await verifyWordPressPassword("secret-password", hash!);
    assert.deepEqual(result, {
      ok: true,
      algorithm: "phpass",
      needsRehash: true
    });
  });

  it("verifies WordPress 6.8 prefixed bcrypt hashes", async () => {
    const prehashed = createHmac("sha384", "wp-sha384")
      .update("secret-password")
      .digest("base64");
    const bcryptHash = await bcrypt.hash(prehashed, 10);
    const wpHash = `$wp${bcryptHash.replace("$2b$", "$2y$")}`;

    const result = await verifyWordPressPassword("secret-password", wpHash);
    assert.deepEqual(result, {
      ok: true,
      algorithm: "wordpress-bcrypt",
      needsRehash: true
    });
  });

  it("verifies legacy md5 hashes", async () => {
    const result = await verifyWordPressPassword(
      "secret-password",
      "2304d4770a72d09106045fea654c4188"
    );
    assert.equal(result.ok, true);
    assert.equal(result.algorithm, "md5");
  });

  it("creates modern application hashes", async () => {
    const hash = await hashApplicationPassword("secret-password");
    assert.equal(hash.startsWith("$2"), true);
    assert.equal((await verifyWordPressPassword("secret-password", hash)).ok, true);
  });
});
