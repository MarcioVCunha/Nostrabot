import { ensureAdminKey, getStoredAdminKey, adminHeaders } from "./admin-key.js";
import { compressAudioFile } from "./compress.js";
import {
  isSchemaMissingError,
  publicAudioUrl,
  supabase
} from "./supabase-client.js";

export class SchemaMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaMissingError";
    this.schemaMissing = true;
  }
}

function mapAudioRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    weight: row.weight ?? 1,
    storagePath: row.storage_path,
    contentType: row.content_type,
    size: row.size_bytes,
    uploadedAt: row.created_at,
    deletedAt: row.deleted_at,
    url: publicAudioUrl(row.storage_path),
    pathname: row.storage_path
  };
}

export async function getAllAudioRecords({ query = "", trashed = false } = {}) {
  try {
    if (trashed) {
      const key = ensureAdminKey();
      if (!key) throw new Error("Chave de admin necessaria para ver a lixeira.");
      const { data, error } = await supabase.rpc("list_trashed_audios", {
        p_admin_key: key
      });
      if (error) throw error;
      return (data || []).map(mapAudioRow);
    }

    let request = supabase
      .from("audios")
      .select(
        "id,name,description,weight,storage_path,content_type,size_bytes,created_at,deleted_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const q = query.trim();
    if (q) {
      request = request.or(
        `name.ilike.%${q}%,description.ilike.%${q}%`
      );
    }

    const { data, error } = await request;
    if (error) throw error;
    return (data || []).map(mapAudioRow);
  } catch (error) {
    if (isSchemaMissingError(error)) {
      throw new SchemaMissingError(
        "Banco ainda sem tabelas. Aplique supabase/migrations e recarregue."
      );
    }
    throw new Error(
      error?.message ||
        "Nao foi possivel listar os audios. Verifique a conexao."
    );
  }
}

async function requestSignedUpload({ name, description, contentType, weight }) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessaria para enviar audios.");

  const response = await fetch("/api/audio-signed-upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders()
    },
    body: JSON.stringify({ name, description, contentType, weight })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha ao obter URL assinada de upload.");
  }
  return data;
}

export async function uploadAudioFile(file, options = {}) {
  const {
    description = "",
    weight = 1,
    compress = true,
    onProgress
  } = options;

  if (!file) throw new Error("Nenhum arquivo selecionado.");

  let working = file;
  if (compress) {
    if (typeof onProgress === "function") onProgress({ stage: "compress", value: 0 });
    working = await compressAudioFile(file, (value) => {
      if (typeof onProgress === "function") {
        onProgress({ stage: "compress", value });
      }
    });
  }

  if (!working.type?.startsWith("audio/")) {
    throw new Error(`"${file.name}" nao e audio/*.`);
  }

  const signed = await requestSignedUpload({
    name: file.name.replace(/\.[^.]+$/, "") || working.name,
    description,
    contentType: working.type || "audio/webm",
    weight
  });

  if (typeof onProgress === "function") {
    onProgress({ stage: "upload", value: 0.1 });
  }

  const { error: uploadError } = await supabase.storage
    .from("audios")
    .uploadToSignedUrl(signed.path || signed.storagePath, signed.token, working, {
      contentType: signed.contentType,
      upsert: false
    });

  if (uploadError) {
    throw new Error(uploadError.message || "Falha no upload para o Storage.");
  }

  if (typeof onProgress === "function") {
    onProgress({ stage: "upload", value: 0.85 });
  }

  const { error: finalizeError } = await supabase.rpc("finalize_audio_upload", {
    p_admin_key: getStoredAdminKey(),
    p_id: signed.id,
    p_size_bytes: working.size
  });
  if (finalizeError) {
    if (isSchemaMissingError(finalizeError)) {
      throw new SchemaMissingError(
        "Banco ainda sem tabelas. Aplique supabase/migrations e recarregue."
      );
    }
    throw new Error(finalizeError.message || "Falha ao finalizar upload.");
  }

  if (typeof onProgress === "function") {
    onProgress({ stage: "upload", value: 1 });
  }

  return {
    id: signed.id,
    url: publicAudioUrl(signed.storagePath),
    pathname: signed.storagePath
  };
}

export async function deleteAudioRecord(id) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessaria para excluir audios.");

  const { error } = await supabase.rpc("soft_delete_audio", {
    p_admin_key: key,
    p_id: id
  });
  if (error) {
    if (isSchemaMissingError(error)) {
      throw new SchemaMissingError(
        "Banco ainda sem tabelas. Aplique supabase/migrations e recarregue."
      );
    }
    throw new Error(error.message || "Falha ao mover audio para a lixeira.");
  }
}

export async function restoreAudioRecord(id) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessaria para restaurar audios.");

  const { error } = await supabase.rpc("restore_audio", {
    p_admin_key: key,
    p_id: id
  });
  if (error) {
    throw new Error(error.message || "Falha ao restaurar audio.");
  }
}

export async function updateAudioMeta(id, { name, description, weight }) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessaria.");

  const { data, error } = await supabase.rpc("update_audio_meta", {
    p_admin_key: key,
    p_id: id,
    p_name: name ?? null,
    p_description: description ?? null,
    p_weight: weight ?? null
  });
  if (error) throw new Error(error.message || "Falha ao atualizar audio.");
  return data;
}

export async function runBlobMigration() {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessaria para migrar.");

  const response = await fetch("/api/migrate-from-blob", {
    method: "POST",
    headers: adminHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha na migracao Blob -> Supabase.");
  }
  return data;
}
