const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sha256Hex } = require("../lib/admin-hash");

describe("sha256Hex", () => {
  it("gera hash hex sha256 de 64 caracteres", () => {
    const hash = sha256Hex("nostrabot");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
    assert.equal(sha256Hex("nostrabot"), hash);
    assert.notEqual(sha256Hex("a"), sha256Hex("b"));
  });
});
