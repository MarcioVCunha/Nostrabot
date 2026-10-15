const { roomPathname, newId } = require("./blob-helpers");
const { readJsonBlob, writeJsonBlob, updateJsonBlob } = require("./json-blob");
const audioIndex = require("./audio-index");
const { drawWeightedRecord } = require("./draw");

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function idleState(revision = 0) {
  return {
    status: "idle",
    revision: Math.max(0, Number(revision) || 0),
    endsAt: null,
    drawnAudioId: null,
    drawnAudio: null,
    nextDrawnAudioId: null,
    nextDrawnAudio: null,
    durationMs: null,
    remainingMs: null,
    autoRepeat: false,
    noRepeatUntilAll: false,
    drawCycleUrls: []
  };
}

function withServerNow(room) {
  return {
    ...room,
    server_now: new Date().toISOString()
  };
}

function audioSnapshot(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name || "audio",
    url: record.url
  };
}

function memoryStorageFromUrls(urls) {
  const data = {
    nostrabotDrawCycle: JSON.stringify(Array.isArray(urls) ? urls : [])
  };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    _urls() {
      try {
        const parsed = JSON.parse(data.nostrabotDrawCycle || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }
  };
}

function weightsFromRecords(records) {
  const weights = {};
  for (const record of records || []) {
    if (record?.url) {
      weights[record.url] = Math.max(1, Number(record.weight) || 1);
    }
  }
  return weights;
}

/**
 * Draw one audio for a room, updating the room-scoped no-repeat cycle.
 * @returns {{ chosen: object | null, drawCycleUrls: string[] }}
 */
function drawForRoom(records, state) {
  const storage = memoryStorageFromUrls(state?.drawCycleUrls || []);
  const weights = weightsFromRecords(records);
  const chosen = drawWeightedRecord(records, weights, {
    noRepeatUntilAll: Boolean(state?.noRepeatUntilAll),
    storage
  });
  return {
    chosen,
    drawCycleUrls: storage._urls()
  };
}

function nextRevision(state) {
  return Math.max(0, Number(state?.revision) || 0) + 1;
}

function isActivelyRunning(state, now = Date.now()) {
  if (!state || state.status !== "running" || !state.endsAt) return false;
  const endsAt = new Date(state.endsAt).getTime();
  return Number.isFinite(endsAt) && endsAt > now + 1500;
}

async function createRoom(name = "Sala Nostrabot") {
  let code = makeRoomCode();
  for (let i = 0; i < 5; i += 1) {
    const { data } = await readJsonBlob(roomPathname(code), null);
    if (!data) break;
    code = makeRoomCode();
  }

  const room = {
    id: newId(),
    code,
    name: String(name || "Sala Nostrabot").slice(0, 80),
    state: idleState(0),
    updated_at: new Date().toISOString()
  };
  await writeJsonBlob(roomPathname(code), room);
  return withServerNow(room);
}

async function getRoom(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const { data } = await readJsonBlob(roomPathname(normalized), null);
  if (!data) return null;
  return withServerNow(data);
}

/**
 * Patch room state with optimistic concurrency (etag retry).
 * Increments revision on every successful mutation.
 */
async function setRoomState(code, partialState) {
  const normalized = String(code || "").trim().toUpperCase();
  const pathname = roomPathname(normalized);
  const next = await updateJsonBlob(pathname, null, (current) => {
    if (!current) {
      throw new Error("Sala nao encontrada.");
    }
    const prev = current.state || idleState(0);
    return {
      ...current,
      state: {
        ...prev,
        ...(partialState || {}),
        revision: nextRevision(prev)
      },
      updated_at: new Date().toISOString()
    };
  });
  if (!next) throw new Error("Sala nao encontrada.");
  return withServerNow(next);
}

/**
 * Start (or auto-repeat) a room timer. Draw happens once here, server-side.
 * Concurrent starts while already running are no-ops (same revision).
 *
 * @param {string} code
 * @param {number|object} durationOrOptions
 */
async function startRoomTimer(code, durationOrOptions = {}) {
  const options =
    typeof durationOrOptions === "number" || durationOrOptions == null
      ? { durationMs: durationOrOptions }
      : durationOrOptions || {};

  const ms = Math.max(1000, Math.round(Number(options.durationMs) || 0));
  const autoRepeat = Boolean(options.autoRepeat);
  const noRepeatUntilAll =
    options.noRepeatUntilAll != null
      ? Boolean(options.noRepeatUntilAll)
      : undefined;

  const normalized = String(code || "").trim().toUpperCase();
  const pathname = roomPathname(normalized);
  const records = await audioIndex.listAudioRecords({ trashed: false });

  const next = await updateJsonBlob(pathname, null, (current) => {
    if (!current) {
      throw new Error("Sala nao encontrada.");
    }

    const prev = { ...idleState(0), ...(current.state || {}) };
    if (noRepeatUntilAll !== undefined) {
      prev.noRepeatUntilAll = noRepeatUntilAll;
    }
    if (options.autoRepeat != null) {
      prev.autoRepeat = autoRepeat;
    }

    // Idempotent: another client already started this cycle.
    if (isActivelyRunning(prev)) {
      return current;
    }

    let working = { ...prev };
    let chosen = null;
    let drawCycleUrls = Array.isArray(working.drawCycleUrls)
      ? [...working.drawCycleUrls]
      : [];

    // Auto-repeat: promote the pre-drawn next audio when available.
    if (
      working.nextDrawnAudioId &&
      working.nextDrawnAudio &&
      working.status !== "idle"
    ) {
      chosen = working.nextDrawnAudio;
      drawCycleUrls = Array.isArray(working.drawCycleUrls)
        ? [...working.drawCycleUrls]
        : [];
    } else {
      const first = drawForRoom(records, {
        ...working,
        drawCycleUrls
      });
      chosen = first.chosen ? audioSnapshot(first.chosen) : null;
      drawCycleUrls = first.drawCycleUrls;
    }

    if (!chosen) {
      return {
        ...current,
        state: {
          ...idleState(nextRevision(prev)),
          autoRepeat: working.autoRepeat,
          noRepeatUntilAll: working.noRepeatUntilAll,
          drawCycleUrls
        },
        updated_at: new Date().toISOString()
      };
    }

    let nextDrawn = null;
    let nextCycle = drawCycleUrls;
    if (working.autoRepeat && records.length) {
      const second = drawForRoom(records, {
        ...working,
        drawCycleUrls: nextCycle
      });
      nextDrawn = second.chosen ? audioSnapshot(second.chosen) : null;
      nextCycle = second.drawCycleUrls;
    }

    const now = Date.now();
    return {
      ...current,
      state: {
        status: "running",
        revision: nextRevision(prev),
        endsAt: new Date(now + ms).toISOString(),
        drawnAudioId: chosen.id,
        drawnAudio: chosen,
        nextDrawnAudioId: nextDrawn?.id || null,
        nextDrawnAudio: nextDrawn,
        durationMs: ms,
        remainingMs: null,
        autoRepeat: working.autoRepeat,
        noRepeatUntilAll: working.noRepeatUntilAll,
        drawCycleUrls: nextCycle
      },
      updated_at: new Date().toISOString()
    };
  });

  if (!next) throw new Error("Sala nao encontrada.");
  return withServerNow(next);
}

async function cancelRoomTimer(code) {
  return setRoomState(code, {
    status: "idle",
    endsAt: null,
    remainingMs: null,
    drawnAudioId: null,
    drawnAudio: null,
    nextDrawnAudioId: null,
    nextDrawnAudio: null,
    durationMs: null
  });
}

module.exports = {
  createRoom,
  getRoom,
  setRoomState,
  startRoomTimer,
  cancelRoomTimer,
  withServerNow,
  idleState,
  drawForRoom,
  isActivelyRunning,
  audioSnapshot
};
