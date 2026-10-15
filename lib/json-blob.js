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
 * Write JSON. With ifMatch → conditional overwrite. Without → create-only
 * (no allowOverwrite) so concurrent first-writes cannot clobber each other.
 * @param {string} pathname
 * @param {*} data
 * @param {{ ifMatch?: string | null }} [options]
 */
async function writeJsonBlob(pathname, data, options = {}) {
  const body = JSON.stringify(data);
  const putOptions = {
    access: "public",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false
  };
  if (options.ifMatch) {
    putOptions.allowOverwrite = true;
    putOptions.ifMatch = options.ifMatch;
  }
  return put(pathname, body, putOptions);
}

function isConflictError(error) {
  const message = String(error?.message || error || "");
  return (
    error?.name === "BlobPreconditionFailedError" ||
    /precondition|412|ifMatch|etag|mismatch|Conflict|already exists|já existe/i.test(
      message
    )
  );
}

/**
 * Read-modify-write with etag retry (up to 8 attempts).
 * Create path is create-only; conflicts force a fresh read.
 * @template T
 * @param {string} pathname
 * @param {T} fallback
 * @param {(current: T) => T | Promise<T>} mutator
 */
async function updateJsonBlob(pathname, fallback, mutator) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, etag } = await readJsonBlob(pathname, fallback);
    const next = await mutator(
      data == null ? structuredCloneSafe(fallback) : data
    );
    try {
      await writeJsonBlob(pathname, next, {
        ifMatch: etag || undefined
      });
      return next;
    } catch (error) {
      lastError = error;
      if (isConflictError(error)) {
        await sleep(25 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error(`Falha ao atualizar ${pathname}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  isConflictError,
  sendJson,
  requireBlobToken
};
