const { put, head, BlobNotFoundError } = require("@vercel/blob");

/**
 * Read a JSON blob by pathname via head() + fetch (public URL).
 * Avoids get(..., { access: "public" }) which 403s on this store.
 * @param {string} pathname
 * @param {*} [fallback]
 * @returns {Promise<{ data: *, etag: string | null }>}
 */
async function readJsonBlob(pathname, fallback = null) {
  try {
    const meta = await head(pathname);
    const bustUrl = new URL(meta.url);
    bustUrl.searchParams.set("_ts", String(Date.now()));
    const res = await fetch(bustUrl.toString(), { cache: "no-store" });
    if (res.status === 404) {
      return { data: fallback, etag: null };
    }
    if (!res.ok) {
      throw new Error(`Falha ao ler ${pathname} (${res.status})`);
    }
    const text = await res.text();
    if (!text) {
      return { data: fallback, etag: meta.etag || null };
    }
    return {
      data: JSON.parse(text),
      etag: meta.etag || null
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { data: fallback, etag: null };
    }
    throw error;
  }
}

/**
 * Write JSON with overwrite. Pass ifMatch for optimistic concurrency.
 * @param {string} pathname
 * @param {*} data
 * @param {{ ifMatch?: string | null }} [options]
 */
async function writeJsonBlob(pathname, data, options = {}) {
  const body = JSON.stringify(data);
  const putOptions = {
    access: "public",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true
  };
  if (options.ifMatch) {
    putOptions.ifMatch = options.ifMatch;
  }
  return put(pathname, body, putOptions);
}

/**
 * Read-modify-write with etag retry (up to 5 attempts).
 * @template T
 * @param {string} pathname
 * @param {T} fallback
 * @param {(current: T) => T | Promise<T>} mutator
 */
async function updateJsonBlob(pathname, fallback, mutator) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, etag } = await readJsonBlob(pathname, fallback);
    const next = await mutator(
      data == null ? structuredCloneSafe(fallback) : data
    );
    try {
      await writeJsonBlob(pathname, next, { ifMatch: etag || undefined });
      return next;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      if (
        /precondition|412|ifMatch|etag|mismatch|Conflict|já existe|already exists/i.test(
          message
        ) ||
        error?.name === "BlobPreconditionFailedError"
      ) {
        continue;
      }
      if (!etag) continue;
      throw error;
    }
  }
  throw lastError || new Error(`Falha ao atualizar ${pathname}`);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function isNotFound(error) {
  if (error instanceof BlobNotFoundError) return true;
  const message = String(error?.message || error || "");
  const code = error?.status || error?.statusCode || error?.code;
  return (
    code === 404 ||
    /not found|404|NoSuchKey|does not exist|The requested blob was not found/i.test(
      message
    )
  );
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function requireBlobToken(res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    sendJson(res, 500, {
      error:
        "BLOB_READ_WRITE_TOKEN nao configurado no projeto Vercel. Crie um Blob store e redeploy."
    });
    return false;
  }
  return true;
}

module.exports = {
  readJsonBlob,
  writeJsonBlob,
  updateJsonBlob,
  isNotFound,
  sendJson,
  requireBlobToken
};
