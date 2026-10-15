const { list, put, del } = require("@vercel/blob");
const { ROOM_PREFIX, newId } = require("./blob-helpers");
const { isConflictError } = require("./json-blob");

function roomLegacyPath(code) {
  return `${ROOM_PREFIX}${String(code || "").toUpperCase()}.json`;
}

function roomVersionPrefix(code) {
  return `${ROOM_PREFIX}${String(code || "").toUpperCase()}/`;
}

function roomVersionPath(code, revision, token) {
  return `${roomVersionPrefix(code)}r${Number(revision) || 0}-${token}.json`;
}

/**
 * Read latest room document via Blob list() (API, not CDN) + unique version URL.
 * Falls back to legacy rooms/CODE.json for older rooms.
 */
async function readRoomBlob(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return { data: null, etag: null, pathname: null };

  const prefix = roomVersionPrefix(normalized);
  const listed = await list({ prefix, limit: 100 });
  const revFromPath = (pathname) => {
    const match = String(pathname || "").match(/\/r(\d+)-/);
    return match ? Number(match[1]) : -1;
  };
  const blobs = [...(listed.blobs || [])].sort((a, b) => {
    const revDiff = revFromPath(b.pathname) - revFromPath(a.pathname);
    if (revDiff !== 0) return revDiff;
    const aTime = new Date(a.uploadedAt || 0).getTime();
    const bTime = new Date(b.uploadedAt || 0).getTime();
    return bTime - aTime;
  });

  if (blobs[0]?.url) {
    const bust = new URL(blobs[0].url);
    bust.searchParams.set("_ts", String(Date.now()));
    const res = await fetch(bust.toString(), { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      if (text) {
        return {
          data: JSON.parse(text),
          etag: blobs[0].etag || null,
          pathname: blobs[0].pathname
        };
      }
    }
  }

  // Legacy single-file rooms
  const legacyPath = roomLegacyPath(normalized);
  try {
    const legacyList = await list({ prefix: legacyPath, limit: 1 });
    const hit = (legacyList.blobs || []).find((b) => b.pathname === legacyPath);
    if (hit?.url) {
      const bust = new URL(hit.url);
      bust.searchParams.set("_ts", String(Date.now()));
      const res = await fetch(bust.toString(), { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        if (text) {
          return {
            data: JSON.parse(text),
            etag: hit.etag || null,
            pathname: hit.pathname
          };
        }
      }
    }
  } catch (error) {
    // ignore
  }

  return { data: null, etag: null, pathname: null };
}

/**
 * Write a new uniquely-named room version (never CDN-stale on first read).
 * Also mirrors to legacy path for older readers.
 */
async function writeRoomBlob(code, room) {
  const normalized = String(code || "").trim().toUpperCase();
  const revision = Number(room?.state?.revision) || 0;
  const token = room?.state?.writeToken || newId();
  const pathname = roomVersionPath(normalized, revision, token);
  const body = JSON.stringify(room);
  const putOptions = {
    access: "public",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  };
  await put(pathname, body, putOptions);
  // Best-effort legacy mirror (may race; list()-based reads ignore it when versions exist)
  try {
    await put(roomLegacyPath(normalized), body, putOptions);
  } catch (error) {
    // ignore legacy mirror failures
  }
  return { pathname, room };
}

/**
 * Optimistic RMW for rooms using versioned blobs.
 * Concurrent writers: last list()-visible version wins; losers retry or no-op.
 */
async function updateRoomBlob(code, mutator) {
  const normalized = String(code || "").trim().toUpperCase();
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: current } = await readRoomBlob(normalized);
    const next = await mutator(current);
    if (next === current) {
      return current;
    }
    if (!next) {
      throw new Error("Sala nao encontrada.");
    }
    // Ensure write token for uniqueness
    if (next.state && !next.state.writeToken) {
      next.state.writeToken = newId();
    }
    try {
      await writeRoomBlob(normalized, next);
      // Confirm tip via list() — not CDN
      await sleep(40 + attempt * 20);
      const { data: verified } = await readRoomBlob(normalized);
      if (!verified) return next;
      const vRev = Number(verified.state?.revision) || 0;
      const nRev = Number(next.state?.revision) || 0;
      if (vRev > nRev) return verified;
      if (
        vRev === nRev &&
        verified.state?.writeToken &&
        next.state?.writeToken &&
        verified.state.writeToken !== next.state.writeToken
      ) {
        // Same revision race — prefer the tip list() returned
        return verified;
      }
      return verified;
    } catch (error) {
      lastError = error;
      if (isConflictError(error)) {
        await sleep(25 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error(`Falha ao atualizar sala ${normalized}`);
}

async function createRoomBlob(code, room) {
  if (!room.state) room.state = {};
  if (!room.state.writeToken) room.state.writeToken = newId();
  await writeRoomBlob(code, room);
  return room;
}

/** Best-effort cleanup of older versions (keep latest 5). */
async function pruneRoomVersions(code, keep = 5) {
  const normalized = String(code || "").trim().toUpperCase();
  const listed = await list({ prefix: roomVersionPrefix(normalized), limit: 100 });
  const blobs = [...(listed.blobs || [])].sort((a, b) => {
    return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
  });
  for (const blob of blobs.slice(keep)) {
    try {
      await del(blob.url);
    } catch (error) {
      // ignore
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  readRoomBlob,
  writeRoomBlob,
  updateRoomBlob,
  createRoomBlob,
  pruneRoomVersions,
  roomLegacyPath,
  roomVersionPath
};
