const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkAdminKey, ADMIN_HEADER } = require("../lib/admin-auth");

describe("checkAdminKey", () => {
  it("rejeita escrita quando NOSTRABOT_ADMIN_KEY nao esta definida", () => {
    const result = checkAdminKey({ [ADMIN_HEADER]: "qualquer" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.match(result.error, /NOSTRABOT_ADMIN_KEY/);
  });

  it("rejeita escrita quando a env var esta vazia", () => {
    const result = checkAdminKey({ [ADMIN_HEADER]: "x" }, {
      NOSTRABOT_ADMIN_KEY: "   "
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  });

  it("rejeita quando o cabecalho esta ausente", () => {
    const result = checkAdminKey({}, { NOSTRABOT_ADMIN_KEY: "segredo" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.error, /ausente/i);
  });

  it("rejeita quando a chave esta errada", () => {
    const result = checkAdminKey(
      { [ADMIN_HEADER]: "errada" },
      { NOSTRABOT_ADMIN_KEY: "segredo" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.error, /invalida/i);
  });

  it("aceita quando a chave confere", () => {
    const result = checkAdminKey(
      { [ADMIN_HEADER]: "segredo" },
      { NOSTRABOT_ADMIN_KEY: "segredo" }
    );
    assert.deepEqual(result, { ok: true });
  });
});
