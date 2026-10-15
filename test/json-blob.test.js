const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

/**
 * Reproduz o bug: get() 403 + head not-found deve virar fallback,
 * nao relancar o 403 original.
 */
describe("readJsonBlob head-first behavior", () => {
  it("nao usa get(); head 404 retorna fallback sem 403", async () => {
    const originalLoad = Module._load;
    const headCalls = [];

    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "@vercel/blob") {
        return {
          put: async () => ({}),
          head: async (pathname) => {
            headCalls.push(pathname);
            const err = new Error("The requested blob was not found");
            err.status = 404;
            throw err;
          },
          get: async () => {
            throw new Error("get() nao deve ser chamado");
          },
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
      assert.deepEqual(headCalls, ["data/audios-index.json"]);
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });

  it("usa etag do head e faz fetch com cache-bust", async () => {
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
        async text() {
          return JSON.stringify({
            version: 1,
            items: [{ id: "1", name: "Deram 20 minutos" }]
          });
        },
        async json() {
          return JSON.parse(await this.text());
        }
      };
    };

    try {
      delete require.cache[require.resolve("../lib/json-blob.js")];
      const { readJsonBlob } = require("../lib/json-blob.js");
      const result = await readJsonBlob("data/audios-index.json", null);
      assert.equal(result.etag, '"etag-123"');
      assert.equal(result.data.items[0].name, "Deram 20 minutos");
      assert.match(fetchedUrl, /_ts=/);
    } finally {
      Module._load = originalLoad;
      global.fetch = originalFetch;
      delete require.cache[require.resolve("../lib/json-blob.js")];
    }
  });
});
