import { friendlyUserError } from "./errors.js";

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

export function getClockOffsetMs() {
  return clockOffsetMs;
}

function noStoreFetch(url, options = {}) {
  const bust = new URL(url, window.location.origin);
  bust.searchParams.set("_ts", String(Date.now()));
  return fetch(bust.toString(), {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.headers || {}),
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });
}

async function readRoomError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return friendlyUserError(data.error || fallback, fallback);
}

export async function syncServerClock() {
  try {
    const response = await noStoreFetch("/api/rooms");
    const data = await response.json().catch(() => ({}));
    if (data.server_now) applyServerNow(data.server_now);
    return clockOffsetMs;
  } catch (error) {
    console.warn(error);
    return clockOffsetMs;
  }
}

export async function createRoom(name = "Sala Nostrabot") {
  const response = await noStoreFetch("/api/rooms", {
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
  const response = await noStoreFetch(
    `/api/rooms?code=${encodeURIComponent(String(code || "").toUpperCase())}`
  );
  if (!response.ok) {
    throw new Error(await readRoomError(response, "Sala não encontrada."));
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

export async function startRoomTimer(code, durationMs, options = {}) {
  const response = await noStoreFetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start",
      code,
      durationMs: Math.round(durationMs),
      autoRepeat: Boolean(options.autoRepeat),
      noRepeatUntilAll: Boolean(options.noRepeatUntilAll)
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
  const response = await noStoreFetch("/api/rooms", {
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

export async function cancelRoomTimer(code) {
  const response = await noStoreFetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", code })
  });
  if (!response.ok) {
    throw new Error(await readRoomError(response, "Falha ao cancelar sala."));
  }
  const data = await response.json();
  if (data.room?.server_now) applyServerNow(data.room.server_now);
  return data.room;
}

/** Floor so POST start/cancel responses are not overwritten by stale lower polls. */
const revisionFloorByCode = new Map();

export function noteRoomRevision(code, revision) {
  const normalized = String(code || "").trim().toUpperCase();
  const rev = Number(revision);
  if (!normalized || !Number.isFinite(rev)) return;
  const prev = revisionFloorByCode.get(normalized) ?? -1;
  if (rev > prev) revisionFloorByCode.set(normalized, rev);
}

/**
 * Poll room state ~1s. Applies only higher revisions. Pauses while tab hidden.
 * @param {string} code
 * @param {(room: object) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeRoom(code, onChange) {
  let stopped = false;
  let timer = null;
  let lastRevision = -1;
  let hidden = typeof document !== "undefined" && document.hidden;
  const normalized = String(code || "").trim().toUpperCase();

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (ms = 1000) => {
    clearTimer();
    if (stopped || hidden) return;
    timer = setTimeout(tick, ms);
  };

  const tick = async () => {
    if (stopped || hidden) return;
    try {
      const room = await getRoom(code);
      if (stopped || hidden || !room) return;
      // Clock offset from every poll
      if (room.server_now) applyServerNow(room.server_now);

      const revision = Number(room.state?.revision);
      const floor = revisionFloorByCode.get(normalized) ?? -1;
      const rev = Number.isFinite(revision) ? revision : -1;
      const effectiveLast = Math.max(lastRevision, floor);
      if (rev > effectiveLast) {
        lastRevision = rev;
        noteRoomRevision(normalized, rev);
        if (typeof onChange === "function") onChange(room);
      } else if (typeof onChange === "function") {
        // Still notify for clock-driven UI (endsAt countdown) with same revision
        onChange({ ...room, _pollTick: true, _sameRevision: true });
      }
    } catch (error) {
      console.warn("Falha ao sincronizar sala:", error);
    } finally {
      if (!stopped && !hidden) schedule(1000);
    }
  };

  const onVisibility = () => {
    hidden = document.hidden;
    if (hidden) {
      clearTimer();
      return;
    }
    // Resume immediately when tab becomes visible
    tick();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  tick();

  return () => {
    stopped = true;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
