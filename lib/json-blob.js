const { put, head, get, BlobNotFoundError } = require("@vercel/blob");

async function streamToText(stream) {
  if (!stream) return "";
  if (typeof stream.getReader !== "function") {
    // Node might give a Web stream or async iterable
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString(
      "utf8"
    );
  }
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Read a JSON blob by pathname.
 * Prefer authenticated get({ useCache: false }) so CDN never serves stale room/index JSON.
 * Falls back to head()+fetch with cache=0 if needed.
 * @param {string} pathname
 * @param {*} [fallback]
 * @returns {Promise<{ data: *, etag: string | null }>}
 */
async function readJsonBlob(pathname, fallback = null) {
  try {
    // Private+useCache:false bypasses CDN and reads origin (fresh room state).
    const fresh = await get(pathname, {
      access: "private",
      useCache: false
    }).catch((error) => {
      if (isNotFound(error) || /403|401|access|private|public/i.test(String(error?.message || ""))) {
        return null;
      }
      throw error;
    });

    if (fresh && fresh.statusCode === 200 && fresh.stream) {
      const text = await streamToText(fresh.stream);
      if (!text) {
        return { data: fallback, etag: fresh.blob?.etag || null };
      }
      return {
        data: JSON.parse(text),
        etag: fresh.blob?.etag || null
      };
    }

    // Fallback: public head + authenticated cache-busted fetch
    const meta = await head(pathname);
    const bustUrl = new URL(meta.url);
    bustUrl.searchParams.set("cache", "0");
    bustUrl.searchParams.set("_ts", String(Date.now()));
    const headers = {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      headers.Authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
    }
    const res = await fetch(bustUrl.toString(), {
      cache: "no-store",
      headers
    });
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
      etag: meta.etag || res.headers.get("etag") || null
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { data: fallback, etag: null };
    }
    throw error;
  }
}

/**
 * Write JSON at a fixed pathname. Always overwrites in place.
 * Private access so readers can use get({ useCache:false }) without CDN staleness.
 * @param {string} pathname
 * @param {*} data
 * @param {{ ifMatch?: string | null }} [options]
 */
async function writeJsonBlob(pathname, data, options = {}) {
  const body = JSON.stringify(data);
  const putOptions = {
    access: "private",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  };
  if (options.ifMatch) {
    putOptions.ifMatch = options.ifMatch;
  }
  try {
    return await put(pathname, body, putOptions);
  } catch (error) {
    // Older stores / blobs may reject private; fall back to public no-cache.
    if (!/private|access|403|401/i.test(String(error?.message || ""))) {
      throw error;
    }
    return put(pathname, body, {
      ...putOptions,
      access: "public"
    });
  }
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
 * @template T
 * @param {string} pathname
 * @param {T} fallback
 * @param {(current: T) => T | Promise<T>} mutator
 */
async function updateJsonBlob(pathname, fallback, mutator) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, etag } = await readJsonBlob(pathname, fallback);
    const current = data == null ? structuredCloneSafe(fallback) : data;
    const next = await mutator(current);
    // Same reference => mutator no-op (e.g. concurrent room start already applied).
    if (next === current) {
      return current;
    }
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

/**
 * Map storage/API errors to short pt-BR messages (never leak raw vendor text).
 */
function friendlyError(error, fallback = "Algo deu errado. Tente de novo.") {
  const message = String(error?.message || error || "");
  if (!message) return fallback;
  if (/already exists|allowOverwrite|Vercel Blob/i.test(message)) {
    return "Não foi possível salvar. Tente de novo.";
  }
  if (/BLOB_READ_WRITE_TOKEN|nao configurado/i.test(message)) {
    return "Armazenamento indisponível no momento.";
  }
  if (/unauthorized|401|chave de admin|admin key/i.test(message)) {
    return "Chave de admin inválida ou ausente.";
  }
  if (/not found|nao encontrada|404/i.test(message)) {
    return "Não encontrado.";
  }
  if (/precondition|etag|412|Conflict/i.test(message)) {
    return "Conflito ao salvar. Tente de novo.";
  }
  if (/fetch|network|ECONN|ENOTFOUND|Failed to fetch/i.test(message)) {
    return "Falha de conexão. Verifique a internet.";
  }
  // Hide long technical dumps
  if (message.length > 120 || /https?:\/\/|at |Error:|Blob/i.test(message)) {
    return fallback;
  }
  return message;
}

function sendJson(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(status).json(payload);
}

function requireBlobToken(res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    sendJson(res, 500, {
      error: "Armazenamento indisponivel no momento."
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
  friendlyError,
  sendJson,
  requireBlobToken
};
