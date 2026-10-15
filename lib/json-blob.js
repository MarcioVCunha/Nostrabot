const { put, head, BlobNotFoundError } = require("@vercel/blob");

/**
 * Read a JSON blob by pathname via head() + fetch (public URL).
 * Avoids get(..., { access: "public" }) which 403s on this store.
 * Public CDN rejects `cache=0` (400); use `_ts` bust + no-store only.
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
 * Write JSON at a fixed pathname. Always overwrites in place.
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
    // Room/index JSON must not be CDN-cached; readers also cache-bust with _ts.
    cacheControlMaxAge: 0
  };
  if (options.ifMatch) {
    // ifMatch alone authorizes overwrite when etag matches. Do NOT also set
    // allowOverwrite — on this store that combination can ignore the etag and
    // let concurrent room starts clobber each other with different endsAt.
    putOptions.ifMatch = options.ifMatch;
  } else {
    putOptions.allowOverwrite = true;
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
