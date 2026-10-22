const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const FAKE_TOKEN = "vercel_blob_rw_storeid123_secretpart";

describe("publicBlobUrl", () => {
  it("monta URL publica a partir do token sem head()", () => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };
    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { publicBlobUrl, getStoreIdFromToken } = require("../lib/json-blob.js");
      assert.equal(getStoreIdFromToken(FAKE_TOKEN), "storeid123");
      assert.equal(
        publicBlobUrl("data/audios-index.json", FAKE_TOKEN),
        "https://storeid123.public.blob.vercel-storage.com/data/audios-index.json"
      );
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});

describe("writeJsonBlob always allowOverwrite", () => {
  it("sempre passa allowOverwrite:true e addRandomSuffix:false", async () => {
    const originalLoad = Module._load;
    let seen = null;

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async (_pathname, _body, options) => {
            seen = options;
            return { url: "https://x/data.json" };
          },
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { writeJsonBlob } = require("../lib/json-blob.js");

      await writeJsonBlob("data/play-history.json", { version: 1, events: [] });
      assert.equal(seen.allowOverwrite, true);
      assert.equal(seen.addRandomSuffix, false);
      assert.equal(seen.cacheControlMaxAge, 0);

      await writeJsonBlob(
        "data/audios-index.json",
        { version: 1, items: [] },
        { ifMatch: '"etag-1"' }
      );
      assert.equal(seen.ifMatch, '"etag-1"');
      assert.equal(seen.allowOverwrite, undefined);
      assert.equal(seen.addRandomSuffix, false);
      assert.equal(seen.cacheControlMaxAge, 0);
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});

describe("friendlyError", () => {
  it("mapeia erros tecnicos do Blob para pt-BR curto", () => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };
    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { friendlyError } = require("../lib/json-blob.js");
      assert.match(
        friendlyError(new Error("Vercel Blob: This blob already exists")),
        /Não foi possível salvar/
      );
      assert.match(
        friendlyError(new Error("BLOB_READ_WRITE_TOKEN nao configurado")),
        /Armazenamento/
      );
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});

describe("readJsonBlob fetch-first (sem head)", () => {
  it("404 no fetch retorna fallback sem chamar head()", async () => {
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
    let fetchedUrl = "";
    let headCalled = false;

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async () => {
            headCalled = true;
            throw new Error("head() nao deve ser chamado");
          },
          get: async () => {
            throw new Error("get() nao deve ser chamado");
          },
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };

    global.fetch = async (url) => {
      fetchedUrl = String(url);
      return {
        status: 404,
        ok: false,
        headers: { get: () => null },
        async text() {
          return "";
        }
      };
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { readJsonBlob } = require("../lib/json-blob.js");
      const result = await readJsonBlob("data/audios-index.json", {
        version: 1,
        items: []
      });
      assert.deepEqual(result.data, { version: 1, items: [] });
      assert.equal(result.etag, null);
      assert.equal(headCalled, false);
      assert.match(fetchedUrl, /storeid123\.public\.blob\.vercel-storage\.com/);
      assert.match(fetchedUrl, /_ts=/);
      assert.doesNotMatch(fetchedUrl, /cache=0/);
    } finally {
      Module._load = originalLoad;
      global.fetch = originalFetch;
      process.env.BLOB_READ_WRITE_TOKEN = originalToken;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });

  it("usa etag do response e faz fetch com cache-bust", async () => {
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
    let fetchedUrl = "";
    let headCalled = false;

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async () => {
            headCalled = true;
            throw new Error("head() nao deve ser chamado");
          },
          get: async () => {
            throw new Error("get() nao deve ser chamado");
          },
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };

    global.fetch = async (url) => {
      fetchedUrl = String(url);
      return {
        status: 200,
        ok: true,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "etag" ? '"etag-123"' : null;
          }
        },
        async text() {
          return JSON.stringify({
            version: 1,
            items: [{ id: "1", name: "Deram 20 minutos" }]
          });
        }
      };
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { readJsonBlob } = require("../lib/json-blob.js");
      const result = await readJsonBlob("data/audios-index.json", null);
      assert.equal(result.etag, '"etag-123"');
      assert.equal(result.data.items[0].name, "Deram 20 minutos");
      assert.equal(headCalled, false);
      assert.match(fetchedUrl, /_ts=/);
      assert.doesNotMatch(fetchedUrl, /cache=0/);
    } finally {
      Module._load = originalLoad;
      global.fetch = originalFetch;
      process.env.BLOB_READ_WRITE_TOKEN = originalToken;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});
