/**
 * Map raw/technical errors to short pt-BR UI messages.
 */
export function friendlyUserError(error, fallback = "Algo deu errado. Tente de novo.") {
  const message = String(error?.message || error || "").trim();
  if (!message) return fallback;

  if (/already exists|allowOverwrite|Vercel Blob|addRandomSuffix/i.test(message)) {
    return "Não foi possível salvar. Tente de novo.";
  }
  if (/BLOB_READ_WRITE_TOKEN|armazenamento indispon/i.test(message)) {
    return "Armazenamento indisponível no momento.";
  }
  if (/401|unauthorized|chave de admin|admin key/i.test(message)) {
    return "Chave de admin inválida ou ausente.";
  }
  if (/404|nao encontrada|não encontrada|not found/i.test(message)) {
    return "Não encontrado.";
  }
  if (/Failed to fetch|network|ECONN|ENOTFOUND/i.test(message)) {
    return "Falha de conexão. Verifique a internet.";
  }
  if (/content.?type|audio\/\*/i.test(message)) {
    return "Apenas arquivos de áudio são aceitos.";
  }
  if (/too large|25 MB|maximumSize/i.test(message)) {
    return "Arquivo muito grande. Limite de 25 MB.";
  }
  if (message.length > 120 || /https?:\/\/|Stack|at\s+\S+\s+\(/.test(message)) {
    return fallback;
  }
  return message;
}
