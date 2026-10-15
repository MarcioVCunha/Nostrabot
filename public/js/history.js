import { isSchemaMissingError, supabase } from "./supabase-client.js";

export async function recordPlayEvent({ audioId, audioName, audioUrl, roomId }) {
  try {
    const { error } = await supabase.rpc("record_play", {
      p_audio_id: audioId || null,
      p_audio_name: audioName || null,
      p_audio_url: audioUrl || null,
      p_room_id: roomId || null
    });
    if (error && !isSchemaMissingError(error)) {
      console.warn("Falha ao gravar historico:", error.message);
    }
  } catch (error) {
    if (!isSchemaMissingError(error)) {
      console.warn("Falha ao gravar historico:", error);
    }
  }
}

export async function listPlayHistory({ roomId = null, limit = 30 } = {}) {
  try {
    const { data, error } = await supabase.rpc("list_play_history", {
      p_room_id: roomId,
      p_limit: limit
    });
    if (error) {
      if (isSchemaMissingError(error)) return [];
      throw error;
    }
    return data || [];
  } catch (error) {
    if (isSchemaMissingError(error)) return [];
    throw error;
  }
}
