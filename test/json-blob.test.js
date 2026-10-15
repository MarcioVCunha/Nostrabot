const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

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
          head: async () => {
            throw Object.assign(new Error("not found"), { status: 404 });
          },
          get: async () => null,
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { writeJsonBlob } = require("../lib/json-blob.js");

      await writeJsonBlob("rooms/ABCD.json", { code: "ABCD", state: {} });
      assert.equal(seen.allowOverwrite, true);
      assert.equal(seen.addRandomSuffix, false);
      assert.equal(seen.cacheControlMaxAge, 0);
      assert.equal(seen.access, "private");

      await writeJsonBlob(
        "data/audios-index.json",
        { version: 1, items: [] },
        { ifMatch: '"etag-1"' }
      );
      assert.equal(seen.allowOverwrite, true);
      assert.equal(seen.addRandomSuffix, false);
      assert.equal(seen.cacheControlMaxAge, 0);
      assert.equal(seen.ifMatch, '"etag-1"');
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});

describe("friendlyError", () => {
  it("mapeia erros tecnicos do Blob para pt-BR curto", () => {
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
  });
});

describe("readJsonBlob fresh get()", () => {
  it("usa get private useCache:false quando disponivel", async () => {
    const originalLoad = Module._load;
    let getOpts = null;

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async () => {
            throw new Error("head nao deve ser chamado");
          },
          get: async (_pathname, options) => {
            getOpts = options;
            const encoded = new TextEncoder().encode(
              JSON.stringify({ version: 1, items: [{ id: "1", name: "ok" }] })
            );
            return {
              statusCode: 200,
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue(encoded);
                  controller.close();
                }
              }),
              blob: { etag: '"fresh-etag"' }
            };
          },
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { readJsonBlob } = require("../lib/json-blob.js");
      const result = await readJsonBlob("rooms/ABC.json", null);
      assert.equal(getOpts.access, "private");
      assert.equal(getOpts.useCache, false);
      assert.equal(result.etag, '"fresh-etag"');
      assert.equal(result.data.items[0].name, "ok");
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });

  it("fallback head+fetch com cache=0 quando get falha", async () => {
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    let fetchedUrl = "";

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async () => ({
            url: "https://example.public.blob.vercel-storage.com/data/audios-index.json",
            etag: '"etag-123"'
          }),
          get: async () => {
            throw Object.assign(new Error("not found"), { status: 404 });
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
        headers: { get: () => null },
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
      assert.match(fetchedUrl, /cache=0/);
      assert.match(fetchedUrl, /_ts=/);
    } finally {
      Module._load = originalLoad;
      global.fetch = originalFetch;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });

  it("head 404 retorna fallback", async () => {
    const originalLoad = Module._load;
    const headCalls = [];

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async (pathname) => {
            headCalls.push(pathname);
            throw Object.assign(new Error("not found"), { status: 404 });
          },
          get: async () => null,
          BlobNotFoundError: class BlobNotFoundError extends Error {}
        };
      }
      return originalLoad(request, parent, isMain);
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
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});
