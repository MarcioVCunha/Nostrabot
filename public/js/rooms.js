let clockOffsetMs = 0;

export function getRoomCodeFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("room") || "").trim().toUpperCase() || null;
}

export function setRoomInLocation(code) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

export function applyServerNow(serverNowIso) {
  if (!serverNowIso) return clockOffsetMs;
  const serverMs = new Date(serverNowIso).getTime();
  if (!Number.isFinite(serverMs)) return clockOffsetMs;
  clockOffsetMs = serverMs - Date.now();
  return clockOffsetMs;
}

export function serverNowMs() {
  return Date.now() + clockOffsetMs;
}

export async function syncServerClock() {
  try {
    const response = await fetch("/api/rooms");
    const data = await response.json().catch(() => ({}));
    if (data.server_now) applyServerNow(data.server_now);
    return clockOffsetMs;
  } catch (error) {
    console.warn(error);
    return 0;
  }
}

async function readRoomError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return data.error || fallback;
}

export async function createRoom(name = "Sala Nostrabot") {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", name })
  });
  if (!response.ok) {
    throw new Error(await readRoomError(response, "Falha ao criar sala."));
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

export async function getRoom(code) {
  const response = await fetch(
    `/api/rooms?code=${encodeURIComponent(String(code || "").toUpperCase())}`
  );
  if (!response.ok) {
    throw new Error(await readRoomError(response, "Sala não encontrada."));
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

export async function startRoomTimer(code, durationMs) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      code,
      durationMs: Math.round(durationMs)
    })
  });
  if (!response.ok) {
    throw new Error(
      await readRoomError(response, "Falha ao iniciar timer da sala.")
    );
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

export async function setRoomState(code, state) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "state", code, state })
  });
  if (!response.ok) {
    throw new Error(await readRoomError(response, "Falha ao atualizar sala."));
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

/**
 * Poll room state about once per second (replaces Realtime).
 * @param {string} code
 * @param {(room: object) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeRoom(code, onChange) {
  let stopped = false;
  let timer = null;
  let lastUpdated = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const room = await getRoom(code);
      if (stopped || !room) return;
      const stamp = room.updated_at || room.server_now;
      if (stamp !== lastUpdated) {
        lastUpdated = stamp;
        if (typeof onChange === "function") onChange(room);
      } else if (room.server_now) {
        applyServerNow(room.server_now);
      }
    } catch (error) {
      console.warn("Falha ao sincronizar sala:", error);
    } finally {
      if (!stopped) timer = setTimeout(tick, 1000);
    }
  };

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
