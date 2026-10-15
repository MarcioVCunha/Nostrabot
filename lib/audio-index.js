const { del, list } = require("@vercel/blob");
const {
  INDEX_PATHNAME,
  AUDIO_PREFIX,
  isWithinTrashWindow
} = require("./blob-helpers");
const { readJsonBlob, updateJsonBlob } = require("./json-blob");

function emptyIndex() {
  return { version: 1, items: [] };
}

/**
 * Unwrap readJsonBlob result ({ data, etag }) or accept a bare index.
 * Reproduces/fixes the bug where callers treated {data,etag} as the index.
 */
function normalizeAudioIndex(readResult, fallback = emptyIndex()) {
  if (!readResult) return fallback;
  const data = Object.prototype.hasOwnProperty.call(readResult, "data")
    ? readResult.data
    : readResult;
  if (!data || !Array.isArray(data.items)) return fallback;
  return data;
}

async function readAudioIndex() {
  const readResult = await readJsonBlob(INDEX_PATHNAME, emptyIndex());
  return normalizeAudioIndex(readResult, emptyIndex());
}

function purgeExpired(items, now = Date.now()) {
  const kept = [];
  const expired = [];
  for (const item of items) {
    if (item.deletedAt && !isWithinTrashWindow(item.deletedAt, now)) {
      expired.push(item);
    } else {
      kept.push(item);
    }
  }
  return { kept, expired };
}

function referencedPathnames(indexItems) {
  const set = new Set();
  for (const item of indexItems || []) {
    if (item?.pathname) set.add(item.pathname);
  }
  return set;
}

/**
 * Blobs under audios/ that are not referenced by the index.
 */
function findOrphanAudioBlobs(indexItems, blobs) {
  const referenced = referencedPathnames(indexItems);
  return (blobs || []).filter((blob) => {
    const pathname = blob?.pathname || "";
    if (!pathname.startsWith(AUDIO_PREFIX)) return false;
    return !referenced.has(pathname);
  });
}

async function listAllAudioBlobs() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({
      prefix: AUDIO_PREFIX,
      cursor,
      limit: 1000
    });
    blobs.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

/**
 * Delete audios/* blobs not referenced by the index.
 * @param {{ protectPathnames?: Iterable<string> }} [options]
 */
async function cleanupOrphanAudios(options = {}) {
  const protect = new Set(options.protectPathnames || []);
  // Fresh read after a short delay so recent upserts are visible.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const index = await readAudioIndex();
  const blobs = await listAllAudioBlobs();
  const orphans = findOrphanAudioBlobs(index.items, blobs).filter(
    (blob) => !protect.has(blob.pathname)
  );
  const deleted = [];
  for (const blob of orphans) {
    try {
      await del(blob.url);
      deleted.push({
        pathname: blob.pathname,
        url: blob.url,
        status: "deleted"
      });
    } catch (error) {
      deleted.push({
        pathname: blob.pathname,
        url: blob.url,
        status: "error",
        error: error?.message || String(error)
      });
    }
  }
  return {
    scanned: blobs.length,
    indexCount: (index.items || []).length,
    orphanCount: orphans.length,
    deleted: deleted.filter((row) => row.status === "deleted").length,
    errors: deleted.filter((row) => row.status === "error").length,
    results: deleted
  };
}

async function listAudioRecords({ trashed = false, query = "" } = {}) {
  const index = await readAudioIndex();
  const { kept, expired } = purgeExpired(index.items);

  if (expired.length) {
    await updateJsonBlob(INDEX_PATHNAME, emptyIndex(), () => ({
      version: 1,
      items: kept
    }));
    for (const item of expired) {
      if (item.url) {
        try {
          await del(item.url);
        } catch (error) {
          console.warn("Falha ao limpar blob expirado:", item.id, error?.message);
        }
      }
    }
  }

  const q = String(query || "").trim().toLowerCase();
  let items = kept.filter((item) =>
    trashed ? Boolean(item.deletedAt) : !item.deletedAt
  );

  if (q) {
    items = items.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const description = String(item.description || "").toLowerCase();
      return name.includes(q) || description.includes(q);
    });
  }

  items.sort((a, b) => {
    const aTime = new Date(trashed ? a.deletedAt : a.uploadedAt).getTime();
    const bTime = new Date(trashed ? b.deletedAt : b.uploadedAt).getTime();
    return bTime - aTime;
  });

  return items;
}

async function upsertAudioRecord(record) {
  if (!record?.id) throw new Error("id obrigatorio");
  return updateJsonBlob(INDEX_PATHNAME, emptyIndex(), (index) => {
    const items = Array.isArray(index.items) ? [...index.items] : [];
    const idx = items.findIndex((item) => item.id === record.id);
    const next = {
      id: record.id,
      name: record.name || "audio",
      description: record.description || "",
      weight: Number(record.weight) > 0 ? Math.floor(Number(record.weight)) : 1,
      url: record.url,
      pathname: record.pathname,
      contentType: record.contentType || "audio/webm",
      size: Number(record.size) || 0,
      uploadedAt: record.uploadedAt || new Date().toISOString(),
      deletedAt: record.deletedAt ?? null,
      sourceId: record.sourceId || null
    };
    if (idx >= 0) items[idx] = { ...items[idx], ...next };
    else items.unshift(next);
    return { version: 1, items };
  });
}

async function softDeleteAudio(id) {
  let found = false;
  await updateJsonBlob(INDEX_PATHNAME, emptyIndex(), (index) => {
    const items = (index.items || []).map((item) => {
      if (item.id !== id) return item;
      found = true;
      return { ...item, deletedAt: new Date().toISOString() };
    });
    return { version: 1, items };
  });
  if (!found) throw new Error("Audio nao encontrado.");
}

async function restoreAudio(id) {
  let found = false;
  await updateJsonBlob(INDEX_PATHNAME, emptyIndex(), (index) => {
    const items = (index.items || []).map((item) => {
      if (item.id !== id) return item;
      found = true;
      return { ...item, deletedAt: null };
    });
    return { version: 1, items };
  });
  if (!found) throw new Error("Audio nao encontrado.");
}

async function updateAudioMeta(id, { name, description, weight }) {
  let updated = null;
  await updateJsonBlob(INDEX_PATHNAME, emptyIndex(), (index) => {
    const items = (index.items || []).map((item) => {
      if (item.id !== id) return item;
      updated = {
        ...item,
        name: name != null ? String(name).slice(0, 200) : item.name,
        description:
          description != null
            ? String(description).slice(0, 1000)
            : item.description,
        weight:
          weight != null && Number(weight) > 0
            ? Math.floor(Number(weight))
            : item.weight
      };
      return updated;
    });
    return { version: 1, items };
  });
  if (!updated) throw new Error("Audio nao encontrado.");
  return updated;
}

async function findBySourceId(sourceId) {
  if (!sourceId) return null;
  const index = await readAudioIndex();
  return (index.items || []).find((item) => item.sourceId === sourceId) || null;
}

module.exports = {
  INDEX_PATHNAME,
  emptyIndex,
  normalizeAudioIndex,
  readAudioIndex,
  listAudioRecords,
  upsertAudioRecord,
  softDeleteAudio,
  restoreAudio,
  updateAudioMeta,
  findBySourceId,
  findOrphanAudioBlobs,
  cleanupOrphanAudios,
  referencedPathnames
};
