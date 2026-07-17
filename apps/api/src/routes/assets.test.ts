import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assetStreamClaimsValid, parseRangeHeader } from "./assets.js";

describe("assetStreamClaimsValid", () => {
  it("acepta un token con el scope correcto y el mismo assetId de la URL", () => {
    assert.equal(assetStreamClaimsValid({ scope: "asset-stream", assetId: "a1" }, "a1"), true);
  });

  it("rechaza un token emitido para OTRO asset (no sirve para reproducir uno distinto)", () => {
    assert.equal(assetStreamClaimsValid({ scope: "asset-stream", assetId: "a1" }, "a2"), false);
  });

  it("rechaza tokens con scope equivocado o payload no-objeto", () => {
    assert.equal(assetStreamClaimsValid({ scope: "login", assetId: "a1" }, "a1"), false);
    assert.equal(assetStreamClaimsValid(null, "a1"), false);
    assert.equal(assetStreamClaimsValid("nope", "a1"), false);
    assert.equal(assetStreamClaimsValid({ assetId: "a1" }, "a1"), false);
  });
});

describe("parseRangeHeader", () => {
  it("devuelve null cuando no hay header Range (se sirve 200 completo)", () => {
    assert.equal(parseRangeHeader(undefined, 1000), null);
    assert.equal(parseRangeHeader("", 1000), null);
  });

  it("interpreta un rango cerrado bytes=start-end", () => {
    assert.deepEqual(parseRangeHeader("bytes=0-99", 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRangeHeader("bytes=200-299", 1000), { start: 200, end: 299 });
  });

  it("interpreta un rango abierto bytes=start- hasta el final", () => {
    assert.deepEqual(parseRangeHeader("bytes=100-", 1000), { start: 100, end: 999 });
  });

  it("interpreta el sufijo bytes=-N como las últimas N bytes", () => {
    assert.deepEqual(parseRangeHeader("bytes=-100", 1000), { start: 900, end: 999 });
  });

  it("acota el final al tamaño real del blob", () => {
    assert.deepEqual(parseRangeHeader("bytes=0-99999", 1000), { start: 0, end: 999 });
  });

  it("rechaza rangos inválidos, multi-rango y arranques fuera de límite", () => {
    assert.equal(parseRangeHeader("bytes=abc", 1000), null);
    assert.equal(parseRangeHeader("bytes=500-100", 1000), null);
    assert.equal(parseRangeHeader("bytes=0-1,3-4", 1000), null);
    assert.equal(parseRangeHeader("bytes=1000-", 1000), null);
    assert.equal(parseRangeHeader("bytes=0-99", 0), null);
  });
});
