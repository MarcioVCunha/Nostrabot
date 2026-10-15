import { upload } from "https://esm.sh/@vercel/blob@2.3.1/client";
import { ensureAdminKey, getStoredAdminKey, adminHeaders } from "./admin-key.js";
import { compressAudioFile } from "./compress.js";
import { friendlyUserError } from "./errors.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSafeFileName(name) {
  return (name || "audio")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

function extensionFromType(contentType, fallbackName = "") {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  const fromName = String(fallbackName || "").split(".").pop();
  if (fromName && /^[a-z0-9]{2,5}$/i.test(fromName)) return fromName.toLowerCase();
  return "webm";
}

async function readErrorMessage(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return friendlyUserError(data.error || fallback, fallback);
}

function mapRecord(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description || "",
    weight: item.weight ?? 1,
    url: item.url,
    pathname: item.pathname,
    contentType: item.contentType,
    size: item.size,
    uploadedAt: item.uploadedAt,
    deletedAt: item.deletedAt || null
  };
}

export async function getAllAudioRecords({ query = "", trashed = false } = {}) {
  const params = new URLSearchParams();
  if (trashed) params.set("trashed", "1");
  if (query.trim()) params.set("q", query.trim());

  const headers = trashed ? adminHeaders() : {};
  if (trashed) {
    const key = ensureAdminKey();
    if (!key) throw new Error("Chave de admin necessária para ver a lixeira.");
  }

  let response;
  try {
    response = await fetch(`/api/audio?${params}`, { headers });
  } catch (error) {
    throw new Error(
      "Não foi possível listar os áudios. Verifique a conexão."
    );
  }

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Falha ao listar os áudios salvos.")
    );
  }

  const data = await response.json();
  return (data.items || []).map(mapRecord);
}

export async function uploadAudioFile(file, options = {}) {
  const {
    description = "",
    weight = 1,
    compress = true,
    onProgress
  } = options;

  if (!file) throw new Error("Nenhum arquivo selecionado.");

  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessária para enviar áudios.");

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
    throw new Error(`"${file.name}" não é um arquivo de áudio.`);
  }

  if (working.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" excede o limite de 25 MB.`);
  }

  const id = newId();
  const displayName =
    file.name.replace(/\.[^.]+$/, "") || getSafeFileName(working.name) || "audio";
  const ext = extensionFromType(working.type, working.name || file.name);
  const pathname = `audios/${id}.${ext}`;

  if (typeof onProgress === "function") {
    onProgress({ stage: "upload", value: 0.05 });
  }

  let blob;
  try {
    blob = await upload(pathname, working, {
      access: "public",
      handleUploadUrl: "/api/upload",
      headers: {
        "x-admin-key": getStoredAdminKey()
      },
      contentType: working.type,
      clientPayload: JSON.stringify({
        id,
        name: displayName,
        description,
        weight
      }),
      onUploadProgress: ({ percentage }) => {
        if (typeof onProgress === "function") {
          onProgress({
            stage: "upload",
            value: 0.05 + Math.min(0.85, (percentage || 0) / 100) * 0.85
          });
        }
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (/401|unauthorized|chave de admin|admin key/i.test(message)) {
      throw new Error(
        "Chave de admin inválida ou ausente. Use \"Chave\" e tente de novo."
      );
    }
    if (/content.?type|audio\/\*|not allowed|permitid/i.test(message)) {
      throw new Error("Apenas arquivos de áudio são aceitos.");
    }
    if (/too large|maximumSize|25/i.test(message)) {
      throw new Error("Arquivo muito grande. Limite de 25 MB.");
    }
    throw new Error(message || "Falha ao enviar o áudio.");
  }

  const registerRes = await fetch("/api/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders()
    },
    body: JSON.stringify({
      id,
      name: displayName,
      description,
      weight,
      url: blob.url,
      pathname: blob.pathname,
      contentType: working.type,
      size: working.size
    })
  });

  if (!registerRes.ok) {
    throw new Error(
      await readErrorMessage(registerRes, "Falha ao registrar o áudio.")
    );
  }

  if (typeof onProgress === "function") {
    onProgress({ stage: "upload", value: 1 });
  }

  return {
    id,
    url: blob.url,
    pathname: blob.pathname
  };
}

export async function deleteAudioRecord(id) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessária para excluir áudios.");

  const response = await fetch(`/api/audio?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders()
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Falha ao mover o áudio para a lixeira.")
    );
  }
}

export async function restoreAudioRecord(id) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessária para restaurar áudios.");

  const response = await fetch("/api/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders()
    },
    body: JSON.stringify({ action: "restore", id })
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Falha ao restaurar o áudio.")
    );
  }
}

export async function updateAudioMeta(id, { name, description, weight }) {
  const key = ensureAdminKey();
  if (!key) throw new Error("Chave de admin necessária.");

  const response = await fetch("/api/audio", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders()
    },
    body: JSON.stringify({ id, name, description, weight })
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Falha ao atualizar o áudio.")
    );
  }

  const data = await response.json();
  return data.item;
}
