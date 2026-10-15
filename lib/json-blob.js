const { get, put, head, BlobNotFoundError } = require("@vercel/blob");

/**
 * Read a JSON blob by pathname. Returns fallback when missing.
 * @param {string} pathname
 * @param {*} [fallback]
 * @returns {Promise<{ data: *, etag: string | null }>}
 */
async function readJsonBlob(pathname, fallback = null) {
  try {
    const result = await get(pathname, { access: "public", useCache: false });
    if (!result) {
      return { data: fallback, etag: null };
    }
    const text = await streamToString(result.stream);
    if (!text) return { data: fallback, etag: result.blob?.etag || null };
    return {
      data: JSON.parse(text),
      etag: result.blob?.etag || null
    };
  } catch (error) {
    if (isNotFound(error)) return { data: fallback, etag: null };
    // Fallback via head + fetch (public URL)
    try {
      const meta = await head(pathname);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (res.status === 404) return { data: fallback, etag: null };
      if (!res.ok) throw new Error(`Falha ao ler ${pathname} (${res.status})`);
      return { data: await res.json(), etag: meta.etag || null };
    } catch (inner) {
      if (isNotFound(inner)) return { data: fallback, etag: null };
      throw error;
    }
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
 * Read-modify-write with etag retry (up to 3 attempts).
 * @template T
 * @param {string} pathname
 * @param {T} fallback
 * @param {(current: T) => T | Promise<T>} mutator
 */
async function updateJsonBlob(pathname, fallback, mutator) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, etag } = await readJsonBlob(pathname, fallback);
    const next = await mutator(
      data == null ? structuredCloneSafe(fallback) : data
    );
    try {
      await writeJsonBlob(pathname, next, { ifMatch: etag });
      return next;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      if (
        /precondition|412|ifMatch|etag|Conflict|já existe|already exists/i.test(
          message
        ) ||
        error?.name === "BlobPreconditionFailedError"
      ) {
        continue;
      }
      // First write (no etag) race: retry
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
  return code === 404 || /not found|404|NoSuchKey|does not exist/i.test(message);
}

async function streamToString(stream) {
  if (!stream) return "";
  if (typeof stream === "string") return stream;
  if (Buffer.isBuffer(stream)) return stream.toString("utf8");
  if (typeof stream.text === "function") return stream.text();
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
