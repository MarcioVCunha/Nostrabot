const { roomPathname, newId } = require("./blob-helpers");
const { readJsonBlob, writeJsonBlob } = require("./json-blob");

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function withServerNow(room) {
  return {
    ...room,
    server_now: new Date().toISOString()
  };
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
    state: { status: "idle" },
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

async function setRoomState(code, state) {
  const normalized = String(code || "").trim().toUpperCase();
  const { data } = await readJsonBlob(roomPathname(normalized), null);
  if (!data) throw new Error("Sala nao encontrada.");
  const next = {
    ...data,
    state: { ...(data.state || {}), ...(state || {}) },
    updated_at: new Date().toISOString()
  };
  // Last-write-wins for room timer sync
  await writeJsonBlob(roomPathname(normalized), next);
  return withServerNow(next);
}

async function startRoomTimer(code, durationMs) {
  const ms = Math.max(1000, Math.round(Number(durationMs) || 0));
  const now = Date.now();
  return setRoomState(code, {
    status: "running",
    duration_ms: ms,
    remaining_ms: null,
    ends_at: new Date(now + ms).toISOString(),
    drawn_audio: null
  });
}

module.exports = {
  createRoom,
  getRoom,
  setRoomState,
  startRoomTimer,
  withServerNow
};
