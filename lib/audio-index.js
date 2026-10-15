const { del } = require("@vercel/blob");
const {
  INDEX_PATHNAME,
  isWithinTrashWindow
} = require("./blob-helpers");
const { readJsonBlob, updateJsonBlob } = require("./json-blob");

function emptyIndex() {
  return { version: 1, items: [] };
}

async function readAudioIndex() {
  const data = await readJsonBlob(INDEX_PATHNAME, emptyIndex());
  if (!data || !Array.isArray(data.items)) return emptyIndex();
  return data;
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
  readAudioIndex,
  listAudioRecords,
  upsertAudioRecord,
  softDeleteAudio,
  restoreAudio,
  updateAudioMeta,
  findBySourceId
};
