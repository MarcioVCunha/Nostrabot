import { isSchemaMissingError, supabase } from "./supabase-client.js";

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
    const { data, error } = await supabase.rpc("server_now");
    if (error) throw error;
    applyServerNow(data);
    return clockOffsetMs;
  } catch (error) {
    if (!isSchemaMissingError(error)) console.warn(error);
    return 0;
  }
}

export async function createRoom(name = "Sala Nostrabot") {
  const { data, error } = await supabase.rpc("create_room", {
    p_name: name,
    p_host_label: "host"
  });
  if (error) {
    if (isSchemaMissingError(error)) {
      throw new Error("Salas ainda indisponíveis. Tente mais tarde.");
    }
    throw new Error(error.message || "Falha ao criar sala.");
  }
  applyServerNow(data.server_now);
  return data;
}

export async function getRoom(code) {
  const { data, error } = await supabase.rpc("get_room", {
    p_code: code
  });
  if (error) {
    if (isSchemaMissingError(error)) {
      throw new Error("Salas ainda indisponíveis. Tente mais tarde.");
    }
    throw new Error(error.message || "Sala não encontrada.");
  }
  applyServerNow(data.server_now);
  return data;
}

export async function startRoomTimer(code, durationMs) {
  const { data, error } = await supabase.rpc("start_room_timer", {
    p_code: code,
    p_duration_ms: Math.round(durationMs)
  });
  if (error) throw new Error(error.message || "Falha ao iniciar timer da sala.");
  applyServerNow(data.server_now);
  return data;
}

export async function setRoomState(code, state) {
  const { data, error } = await supabase.rpc("set_room_state", {
    p_code: code,
    p_state: state
  });
  if (error) throw new Error(error.message || "Falha ao atualizar sala.");
  applyServerNow(data.server_now);
  return data;
}

export function subscribeRoom(code, onChange) {
  const channel = supabase
    .channel(`room:${code}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "rooms",
        filter: `code=eq.${code}`
      },
      (payload) => {
        if (typeof onChange === "function") onChange(payload.new || payload.record);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
