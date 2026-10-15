import { upload } from "@vercel/blob/client";
import { adminHeaders, ensureAdminKey, getStoredAdminKey } from "./admin-key.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function getSafeFileName(name) {
  return (name || "audio")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

async function readErrorMessage(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return data.error || fallback;
}

export async function getAllAudioRecords() {
  let response;
  try {
    response = await fetch("/api/audio");
  } catch (error) {
    throw new Error(
      "Nao foi possivel listar os audios. Verifique a conexao e tente novamente."
    );
  }

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        "Falha ao listar os audios salvos. Tente novamente em instantes."
      )
    );
  }

  const data = await response.json();
  return data.items || [];
}

export async function deleteAudioRecord(url) {
  const key = ensureAdminKey();
  if (!key) {
    throw new Error("Chave de admin necessaria para excluir audios.");
  }

  let response;
  try {
    response = await fetch(`/api/audio?url=${encodeURIComponent(url)}`, {
      method: "DELETE",
      headers: adminHeaders()
    });
  } catch (error) {
    throw new Error(
      "Nao foi possivel excluir o audio. Verifique a conexao e tente novamente."
    );
  }

  if (response.status === 401) {
    throw new Error(
      await readErrorMessage(
        response,
        "Chave de admin invalida. Use \"Alterar chave\" e tente de novo."
      )
    );
  }

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Falha ao excluir o audio.")
    );
  }
}

export async function uploadAudioFile(file) {
  if (!file.type || !file.type.startsWith("audio/")) {
    throw new Error(
      `"${file.name}" nao e um arquivo de audio. Envie apenas audio/*.`
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" excede o limite de 25 MB por arquivo.`
    );
  }

  const key = ensureAdminKey();
  if (!key) {
    throw new Error("Chave de admin necessaria para enviar audios.");
  }

  const safeName = getSafeFileName(file.name);
  const pathname = `audios/${Date.now()}-${safeName}`;

  try {
    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/upload",
      headers: {
        "x-admin-key": getStoredAdminKey()
      },
      contentType: file.type
    });
    return blob;
  } catch (error) {
    const message = error?.message || String(error);

    if (/401|unauthorized|chave de admin|admin key/i.test(message)) {
      throw new Error(
        "Chave de admin invalida ou ausente. Use \"Alterar chave\" e tente de novo."
      );
    }

    if (/content.?type|audio\/\*|not allowed|permitid/i.test(message)) {
      throw new Error(
        "Apenas arquivos de audio sao aceitos (tipo audio/*)."
      );
    }

    if (/too large|maximumSize|25/i.test(message)) {
      throw new Error("Arquivo muito grande. Limite de 25 MB por upload.");
    }

    throw new Error(
      message || "Falha ao enviar o arquivo para o Vercel Blob."
    );
  }
}
